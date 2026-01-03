// Account Page Script
// 使用 tauri-bridge.js 提供的全局 ipcRenderer, fs, path

let i18nData = {};
let accounts = [];
let currentAccount = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  // 等待 ipcRenderer 准备好
  let retries = 0;
  while (!window.ipcRenderer && retries < 50) {
    await new Promise(r => setTimeout(r, 50));
    retries++;
  }
  
  if (!window.ipcRenderer) {
    console.error('[Account] ipcRenderer not available');
    return;
  }
  
  await loadI18n();
  initBackButton();
  initActionCards();
  initAccountTypes();
  await loadAccounts();
  initMessageListener();
}

// 监听来自父窗口的消息
function initMessageListener() {
  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'reload-i18n') {
      console.log('[Account] Received reload-i18n message');
      await loadI18n();
      // 重新加载账户数据以更新显示
      await loadAccounts();
    } else if (event.data?.action === 'config-updated' && event.data.config) {
      // 应用主题
      applyTheme(event.data.config.theme);
    } else if (event.data?.action === 'show-manual-auth-dialog' && event.data.authUrl) {
      // 显示手动输入对话框（从父窗口传来的 authUrl）
      console.log('[Account] Received show-manual-auth-dialog with authUrl');
      showManualAuthDialog(event.data.authUrl);
    } else if (event.data?.action === 'auth-success') {
      // Deep link 认证成功
      console.log('[Account] Auth success via deep link');
      await loadAccounts();
      showToast(getI18n('account.loginSuccess') || '登录成功', 'success');
    }
  });
}

// 应用主题
function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  
  const accentColor = theme.accent_color || theme.accentColor;
  const gradientColors = theme.gradient_colors || theme.gradientColors;
  
  if (accentColor) {
    root.style.setProperty('--accent', accentColor);
    root.style.setProperty('--accent-soft', hexToRgba(accentColor, 0.12));
  }
  
  if (gradientColors?.length > 0) {
    const gradient = gradientColors.join(', ');
    root.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${gradient})`);
    root.style.setProperty('--gradient-start', gradientColors[0]);
    root.style.setProperty('--gradient-end', gradientColors[gradientColors.length - 1]);
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ═══════════════════════════════════════════════════════════
// i18n
// ═══════════════════════════════════════════════════════════
async function loadI18n() {
  try {
    const config = await ipcRenderer.invoke('get-config');
    const language = config.app?.language || 'zh-CN';
    const response = await fetch(`../../locales/${language}.json`);
    i18nData = await response.json();
    applyI18n();
  } catch (error) {
    console.error('Failed to load i18n:', error);
    // 回退到中文
    try {
      const response = await fetch('../../locales/zh-CN.json');
      i18nData = await response.json();
      applyI18n();
    } catch (e) {
      console.error('Failed to load fallback i18n:', e);
    }
  }
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = getI18n(key);
    if (value) el.textContent = value;
  });
}

function getI18n(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], i18nData);
}

// ═══════════════════════════════════════════════════════════
// 账户数据
// ═══════════════════════════════════════════════════════════
async function loadAccounts() {
  try {
    const result = await ipcRenderer.invoke('get-accounts');
    console.log('[Account] Raw result:', JSON.stringify(result));
    accounts = result.accounts || [];
    // 后端返回 current_account (snake_case)
    currentAccount = result.current_account || result.currentAccount;
    console.log('[Account] Loaded accounts:', accounts.length, 'current:', currentAccount);
    console.log('[Account] Accounts data:', JSON.stringify(accounts));
    updateUI();
  } catch (error) {
    console.error('Failed to load accounts:', error);
  }
}

function updateUI() {
  console.log('[Account] updateUI called, currentAccount:', currentAccount);
  const account = accounts.find(a => a.id === currentAccount);
  console.log('[Account] Found account:', account);
  
  // 使用 Tauri 的 convertFileSrc 转换本地文件路径
  const convertFileSrc = window.__TAURI__?.core?.convertFileSrc || ((path) => `file://${path}`);
  
  // 更新用户名
  const usernameEl = document.querySelector('.username');
  if (usernameEl && account) {
    usernameEl.textContent = account.username;
  } else if (usernameEl) {
    usernameEl.textContent = getI18n('account.noAccount') || '未登录';
  }
  
  // 获取账户类型 (后端 serde rename 为 type)
  const accountType = account?.type || account?.account_type;
  console.log('[Account] Account type:', accountType);
  
  // 更新头像 - 先显示默认图标，等皮肤渲染后会自动更新
  const avatarEl = document.querySelector('.avatar');
  if (avatarEl) {
    avatarEl.innerHTML = '<i class="ri-user-line"></i>';
  }
  
  // 更新账户徽章
  const badge = document.querySelector('.account-badge');
  if (badge && account) {
    if (accountType === 'microsoft') {
      // badge.innerHTML = '<i class="ri-microsoft-fill"></i><span>Microsoft</span>'; // Del Icons
      badge.className = 'account-badge microsoft';
    } else {
      badge.innerHTML = '<i class="ri-user-line"></i><span>' + (getI18n('account.offline') || '离线') + '</span>';
      badge.className = 'account-badge offline';
    }
    badge.style.display = 'flex';
  } else if (badge) {
    badge.style.display = 'none';
  }
  
  // 更新状态
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.user-status span:last-child');
  if (account) {
    statusDot?.classList.add('online');
    if (statusText) statusText.textContent = getI18n('user.online') || '在线';
  } else {
    statusDot?.classList.remove('online');
    if (statusText) statusText.textContent = getI18n('user.offline') || '离线';
  }
  
  // 更新账户类型选择
  updateAccountTypeSelection(account);
  
  // 更新皮肤预览
  updateSkinPreview(account);
}

function updateAccountTypeSelection(account) {
  document.querySelectorAll('.type-item').forEach(item => {
    item.classList.remove('active');
    const check = item.querySelector('.check');
    if (check) check.remove();
  });
  
  if (account) {
    const accountType = account.account_type || account.type;
    const selector = accountType === 'microsoft' ? '.type-icon.microsoft' : '.type-icon.offline';
    const activeItem = document.querySelector(selector)?.closest('.type-item');
    if (activeItem) {
      activeItem.classList.add('active');
      const check = document.createElement('i');
      check.className = 'ri-check-line check';
      activeItem.appendChild(check);
    }
  }
}

let skinViewer = null;

function updateSkinPreview(account) {
  const canvas = document.getElementById('skin-canvas');
  const placeholder = document.getElementById('skin-placeholder');
  
  if (!canvas) return;
  
  const accountType = account?.type || account?.account_type;
  
  if (account && account.skin) {
    // 隐藏占位符，显示 canvas
    if (placeholder) placeholder.style.display = 'none';
    canvas.style.display = 'block';
    
    // 销毁旧的 viewer
    if (skinViewer) {
      skinViewer.dispose();
      skinViewer = null;
    }
    
    // 创建新的 3D 皮肤查看器
    try {
      skinViewer = new skinview3d.SkinViewer({
        canvas: canvas,
        width: 200,
        height: 280,
        skin: account.skin
      });
      
      // 设置相机位置
      skinViewer.camera.position.set(0, 0, 50);
      skinViewer.camera.lookAt(0, 0, 0);
      
      // 添加动画
      skinViewer.animation = new skinview3d.IdleAnimation();
      skinViewer.animation.speed = 0.5;
      
      // 自动旋转
      skinViewer.autoRotate = true;
      skinViewer.autoRotateSpeed = 0.5;
      
      // 允许缩放和旋转
      skinViewer.controls.enableZoom = true;
      skinViewer.controls.enableRotate = true;
      
      console.log('[Account] Skin viewer created for:', account.skin);
      
      // 从 canvas 提取头像并更新
      setTimeout(() => {
        updateAvatarFromSkinViewer(account);
      }, 500);
      
    } catch (e) {
      console.error('[Account] Failed to create skin viewer:', e);
      canvas.style.display = 'none';
      if (placeholder) {
        placeholder.style.display = 'flex';
        placeholder.innerHTML = `
          <i class="ri-body-scan-line"></i>
          <span>${getI18n('account.noSkin') || '暂无皮肤'}</span>
        `;
      }
    }
  } else {
    // 无皮肤
    canvas.style.display = 'none';
    if (placeholder) {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = `
        <i class="ri-body-scan-line"></i>
        <span>${getI18n('account.noSkin') || '暂无皮肤'}</span>
      `;
    }
    
    // 销毁 viewer
    if (skinViewer) {
      skinViewer.dispose();
      skinViewer = null;
    }
    
    // 无皮肤时显示默认头像
    const avatarEl = document.querySelector('.avatar');
    if (avatarEl) {
      avatarEl.innerHTML = '<i class="ri-user-line"></i>';
    }
  }
}

// 从皮肤提取正面头像（2D，脸部+帽子层叠加）
async function updateAvatarFromSkinViewer(account) {
  const avatarEl = document.querySelector('.avatar');
  if (!avatarEl || !account?.id) {
    if (avatarEl) avatarEl.innerHTML = '<i class="ri-user-line"></i>';
    return;
  }
  
  try {
    // 使用后端生成的头像（包含帽子层）
    const avatarResult = await ipcRenderer.invoke('get-account-avatar', account.id);
    console.log('[Account Avatar] Result:', avatarResult);
    
    if (avatarResult.success && avatarResult.avatarPath) {
      const convertFileSrc = window.__TAURI__?.core?.convertFileSrc || ((path) => `file://${path}`);
      const avatarUrl = convertFileSrc(avatarResult.avatarPath);
      // 添加时间戳防止缓存
      avatarEl.innerHTML = `<img src="${avatarUrl}?t=${Date.now()}" alt="Avatar" style="width:100%;height:100%;border-radius:12px;image-rendering:pixelated;">`;
      console.log('[Account Avatar] Avatar loaded from backend');
    } else {
      avatarEl.innerHTML = '<i class="ri-user-line"></i>';
    }
  } catch (e) {
    console.error('[Account Avatar] Failed to get avatar:', e);
    avatarEl.innerHTML = '<i class="ri-user-line"></i>';
  }
}

// ═══════════════════════════════════════════════════════════
// 交互
// ═══════════════════════════════════════════════════════════
function initBackButton() {
  document.getElementById('back-btn')?.addEventListener('click', () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ action: 'back-to-home' }, '*');
    }
  });
}

function initActionCards() {
  const actionCards = document.querySelectorAll('.action-card');
  
  actionCards.forEach(card => {
    card.addEventListener('click', async () => {
      const action = card.dataset.action;
      
      switch (action) {
        case 'refresh':
          await refreshAccount();
          break;
        case 'add':
          await showAddAccountDialog();
          break;
        case 'switch':
          await showSwitchAccountDialog();
          break;
        case 'logout':
          await logoutAccount();
          break;
      }
    });
  });
  
  // 皮肤更换按钮
  document.querySelector('.link-btn')?.addEventListener('click', async () => {
    await changeSkin();
  });
}

function initAccountTypes() {
  document.querySelectorAll('.type-item').forEach(item => {
    item.addEventListener('click', async () => {
      const type = item.querySelector('.type-icon.microsoft') ? 'microsoft' : 'offline';
      
      if (type === 'microsoft') {
        await loginMicrosoft();
      } else {
        await showAddOfflineDialog();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════
// 账户操作
// ═══════════════════════════════════════════════════════════

// 刷新账户
async function refreshAccount() {
  const account = accounts.find(a => a.id === currentAccount);
  if (!account) {
    showToast(getI18n('account.noAccountToRefresh') || '没有可刷新的账户', 'error');
    return;
  }
  
  const accountType = account.account_type || account.type;
  showToast(getI18n('account.refreshing') || '正在刷新...', 'success');
  
  if (accountType === 'microsoft') {
    const result = await ipcRenderer.invoke('refresh-microsoft-account', account.id);
    if (result.success) {
      const index = accounts.findIndex(a => a.id === account.id);
      if (index >= 0) accounts[index] = result.account;
      updateUI();
      showToast(getI18n('account.refreshSuccess') || '刷新成功', 'success');
    } else {
      showToast(result.error || getI18n('account.refreshFailed') || '刷新失败', 'error');
    }
  } else {
    // 离线账户无需刷新
    showToast(getI18n('account.offlineNoRefresh') || '离线账户无需刷新', 'success');
  }
}

// 添加账户对话框
async function showAddAccountDialog() {
  const dialog = createDialog({
    title: getI18n('account.addAccount') || '添加账户',
    content: `
      <div class="dialog-options">
        <button class="dialog-option" data-type="microsoft">
          <div class="option-icon microsoft"><i class="ri-microsoft-fill"></i></div>
          <div class="option-text">
            <span class="option-title">Microsoft</span>
            <span class="option-desc">${getI18n('account.microsoftDesc') || '正版账户'}</span>
          </div>
        </button>
        <button class="dialog-option" data-type="offline">
          <div class="option-icon offline"><i class="ri-user-line"></i></div>
          <div class="option-text">
            <span class="option-title">${getI18n('account.offline') || '离线模式'}</span>
            <span class="option-desc">${getI18n('account.offlineDesc') || '本地游玩'}</span>
          </div>
        </button>
      </div>
    `,
    buttons: []
  });
  
  dialog.querySelectorAll('.dialog-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      closeDialog(dialog);
      if (opt.dataset.type === 'microsoft') {
        await loginMicrosoft();
      } else {
        await showAddOfflineDialog();
      }
    });
  });
}

// 微软登录
async function loginMicrosoft() {
  console.log('[Account] Starting Microsoft login...');
  showToast(getI18n('account.loggingIn') || '正在打开登录页面...', 'success');
  
  try {
    const result = await ipcRenderer.invoke('microsoft-login');
    console.log('[Account] Microsoft login result:', result);
    
    if (result.success) {
      accounts = (await ipcRenderer.invoke('get-accounts')).accounts;
      currentAccount = result.currentAccount || result.account?.id;
      
      // 刷新头像（重新从皮肤提取，包含帽子层）
      if (currentAccount) {
        await ipcRenderer.invoke('refresh-account-avatar', currentAccount);
      }
      
      updateUI();
      showToast(getI18n('account.loginSuccess') || '登录成功！欢迎 ' + (result.account?.username || ''), 'success');
      
      // 通知主窗口更新
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ 
          action: 'avatar-updated', 
          accountId: currentAccount 
        }, '*');
      }
    } else {
      showToast(result.error || getI18n('account.loginFailed') || '登录失败', 'error');
    }
  } catch (error) {
    console.error('[Account] Microsoft login error:', error);
    // 用户取消或超时
    if (error.toString().includes('超时') || error.toString().includes('取消')) {
      showToast('登录已取消', 'error');
    } else {
      showToast('登录失败: ' + error, 'error');
    }
  }
}

// 显示手动输入授权URL的对话框
function showManualAuthDialog(authUrl) {
  console.log('[Account] Showing manual auth dialog');
  
  const dialog = createDialog({
    title: '微软账户登录',
    content: `
      <div class="dialog-input-group">
        <p style="margin-bottom: 12px; color: var(--text-secondary);">
          浏览器已打开登录页面。登录完成后，浏览器会提示打开 "imaginelauncher" 应用。
        </p>
        <p style="margin-bottom: 12px; color: var(--text-secondary);">
          <strong>如果点击"打开"没反应</strong>，请复制浏览器地址栏中的完整URL粘贴到下方：
        </p>
        <label>回调URL</label>
        <input type="text" id="auth-callback-url" placeholder="imaginelauncher://auth/callback?code=...">
        <span class="input-hint">URL 以 imaginelauncher://auth/callback 开头</span>
        <div style="margin-top: 12px;">
          <button class="btn-outline-small" id="copy-auth-url">
            <i class="ri-external-link-line"></i> 重新打开登录页面
          </button>
        </div>
      </div>
    `,
    buttons: [
      { text: '取消', type: 'secondary', action: 'cancel' },
      { text: '确认登录', type: 'primary', action: 'confirm' }
    ]
  });
  
  const input = dialog.querySelector('#auth-callback-url');
  
  // 重新打开登录页面
  dialog.querySelector('#copy-auth-url')?.addEventListener('click', () => {
    if (window.shell?.openExternal) {
      window.shell.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }
  });
  
  dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
    const callbackUrl = input?.value?.trim();
    if (!callbackUrl) {
      showToast('请输入回调URL', 'error');
      return;
    }
    
    // 支持两种格式的URL
    if (!callbackUrl.includes('code=')) {
      showToast('URL中未找到授权码，请确保登录成功后复制完整URL', 'error');
      return;
    }
    
    // 如果是 imaginelauncher:// 格式，转换为可解析的格式
    let urlToParse = callbackUrl;
    if (callbackUrl.startsWith('imaginelauncher://')) {
      // 将自定义协议转换为 http 以便解析
      urlToParse = callbackUrl.replace('imaginelauncher://', 'http://localhost/');
    }
    
    showToast('正在验证登录...', 'success');
    console.log('[Account] Submitting callback URL:', callbackUrl);
    
    try {
      const result = await ipcRenderer.invoke('manual-auth-callback', urlToParse);
      console.log('[Account] Manual auth result:', result);
      
      closeDialog(dialog);
      
      if (result.success) {
        accounts = (await ipcRenderer.invoke('get-accounts')).accounts;
        currentAccount = result.currentAccount || result.account?.id;
        updateUI();
        showToast('登录成功！欢迎 ' + (result.account?.username || ''), 'success');
        
        // 通知主窗口更新
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ 
            action: 'avatar-updated', 
            accountId: currentAccount 
          }, '*');
        }
      } else {
        showToast(result.error || '登录失败', 'error');
      }
    } catch (error) {
      console.error('[Account] Manual auth error:', error);
      showToast('登录失败: ' + error, 'error');
    }
  });
  
  dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    closeDialog(dialog);
  });
  
  // 回车确认
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dialog.querySelector('[data-action="confirm"]')?.click();
    }
  });
}

// 添加离线账户对话框
async function showAddOfflineDialog() {
  const dialog = createDialog({
    title: getI18n('account.addOffline') || '添加离线账户',
    content: `
      <div class="dialog-input-group">
        <label>${getI18n('account.username') || '用户名'}</label>
        <input type="text" id="offline-username" placeholder="${getI18n('account.usernamePlaceholder') || '输入游戏内显示的名称'}" maxlength="16">
        <span class="input-hint">${getI18n('account.usernameHint') || '3-16个字符'}</span>
      </div>
    `,
    buttons: [
      { text: getI18n('common.cancel') || '取消', type: 'secondary', action: 'cancel' },
      { text: getI18n('common.confirm') || '确定', type: 'primary', action: 'confirm' }
    ]
  });
  
  const input = dialog.querySelector('#offline-username');
  input?.focus();
  
  dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
    const username = input?.value?.trim();
    if (!username || username.length < 3) {
      showToast(getI18n('account.usernameInvalid') || '用户名至少需要3个字符', 'error');
      return;
    }
    
    const result = await ipcRenderer.invoke('add-offline-account', username);
    closeDialog(dialog);
    
    if (result.success) {
      accounts.push(result.account);
      currentAccount = result.currentAccount;
      updateUI();
      showToast(getI18n('account.addSuccess') || '添加成功', 'success');
    } else {
      showToast(result.error || getI18n('account.addFailed') || '添加失败', 'error');
    }
  });
  
  dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    closeDialog(dialog);
  });
  
  // 回车确认
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dialog.querySelector('[data-action="confirm"]')?.click();
    }
  });
}

// 切换账户对话框
async function showSwitchAccountDialog() {
  if (accounts.length === 0) {
    showToast(getI18n('account.noAccounts') || '没有可切换的账户', 'error');
    return;
  }
  
  const accountsHtml = accounts.map(acc => {
    const accType = acc.account_type || acc.type;
    return `
    <button class="dialog-option account-option ${acc.id === currentAccount ? 'active' : ''}" data-id="${acc.id}">
      <div class="option-icon ${accType}">
        <i class="${accType === 'microsoft' ? 'ri-microsoft-fill' : 'ri-user-line'}"></i>
      </div>
      <div class="option-text">
        <span class="option-title">${acc.username}</span>
        <span class="option-desc">${accType === 'microsoft' ? 'Microsoft' : (getI18n('account.offline') || '离线')}</span>
      </div>
      ${acc.id === currentAccount ? '<i class="ri-check-line current-check"></i>' : ''}
    </button>
  `}).join('');
  
  const dialog = createDialog({
    title: getI18n('account.switchAccount') || '切换账户',
    content: `<div class="dialog-options">${accountsHtml}</div>`,
    buttons: []
  });
  
  dialog.querySelectorAll('.account-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      const accountId = opt.dataset.id;
      if (accountId === currentAccount) {
        closeDialog(dialog);
        return;
      }
      
      const result = await ipcRenderer.invoke('switch-account', accountId);
      closeDialog(dialog);
      
      if (result.success) {
        currentAccount = result.currentAccount || result.current_account;
        updateUI();
        showToast(getI18n('account.switchSuccess') || '切换成功', 'success');
        
        // 通知主窗口和首页更新账户显示
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ 
            action: 'avatar-updated', 
            accountId: currentAccount 
          }, '*');
        }
      } else {
        showToast(result.error || getI18n('account.switchFailed') || '切换失败', 'error');
      }
    });
  });
}

// 退出登录
async function logoutAccount() {
  const account = accounts.find(a => a.id === currentAccount);
  if (!account) {
    showToast(getI18n('account.noAccountToLogout') || '没有可退出的账户', 'error');
    return;
  }
  
  const dialog = createDialog({
    title: getI18n('account.confirmLogout') || '确认退出',
    content: `<p class="dialog-message">${getI18n('account.logoutMessage') || '确定要退出当前账户吗？'}</p>`,
    buttons: [
      { text: getI18n('common.cancel') || '取消', type: 'secondary', action: 'cancel' },
      { text: getI18n('account.logout') || '退出', type: 'danger', action: 'confirm' }
    ]
  });
  
  dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('remove-account', currentAccount);
    closeDialog(dialog);
    
    if (result.success) {
      accounts = result.accounts;
      currentAccount = result.currentAccount;
      updateUI();
      showToast(getI18n('account.logoutSuccess') || '已退出', 'success');
    } else {
      showToast(result.error || getI18n('account.logoutFailed') || '退出失败', 'error');
    }
  });
  
  dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    closeDialog(dialog);
  });
}

// 更换皮肤
async function changeSkin() {
  const account = accounts.find(a => a.id === currentAccount);
  if (!account) {
    showToast(getI18n('account.noAccountForSkin') || '请先登录账户', 'error');
    return;
  }
  
  const accountType = account.account_type || account.type;
  if (accountType === 'microsoft') {
    showToast(getI18n('account.microsoftSkinHint') || '微软账户请在官网更换皮肤', 'error');
    return;
  }
  
  const result = await ipcRenderer.invoke('select-skin-file');
  if (result.canceled) return;
  
  if (result.success) {
    const setResult = await ipcRenderer.invoke('set-offline-skin', account.id, result.path);
    if (setResult.success) {
      const index = accounts.findIndex(a => a.id === account.id);
      if (index >= 0) accounts[index] = setResult.account;
      updateUI();
      showToast(getI18n('account.skinChanged') || '皮肤已更换', 'success');
      
      // 通知父窗口更新头像
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ 
          action: 'avatar-updated', 
          accountId: account.id 
        }, '*');
      }
    } else {
      showToast(setResult.error || getI18n('account.skinChangeFailed') || '更换失败', 'error');
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 对话框
// ═══════════════════════════════════════════════════════════
function createDialog({ title, content, buttons }) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  
  const buttonsHtml = buttons.map(btn => 
    `<button class="dialog-btn ${btn.type}" data-action="${btn.action}">${btn.text}</button>`
  ).join('');
  
  overlay.innerHTML = `
    <div class="dialog">
      <div class="dialog-header">
        <h3>${title}</h3>
        <button class="dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="dialog-body">${content}</div>
      ${buttons.length > 0 ? `<div class="dialog-footer">${buttonsHtml}</div>` : ''}
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // 关闭按钮
  overlay.querySelector('.dialog-close')?.addEventListener('click', () => closeDialog(overlay));
  
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog(overlay);
  });
  
  // 动画
  requestAnimationFrame(() => overlay.classList.add('show'));
  
  return overlay;
}

function closeDialog(dialog) {
  dialog.classList.remove('show');
  setTimeout(() => dialog.remove(), 200);
}

// ═══════════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════════
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = document.createElement('i');
  icon.className = type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line';
  
  const text = document.createElement('span');
  text.textContent = message;
  
  toast.appendChild(icon);
  toast.appendChild(text);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}
