// Account Page Script
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let i18nData = {};
let accounts = [];
let currentAccount = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  loadI18n();
  initBackButton();
  initActionCards();
  initAccountTypes();
  loadAccounts();
}

// ═══════════════════════════════════════════════════════════
// i18n
// ═══════════════════════════════════════════════════════════
async function loadI18n() {
  try {
    const i18nPath = path.join(__dirname, '../../locales/zh-CN.json');
    const data = fs.readFileSync(i18nPath, 'utf8');
    i18nData = JSON.parse(data);
    applyI18n();
  } catch (error) {
    console.error('Failed to load i18n:', error);
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
    accounts = result.accounts || [];
    currentAccount = result.currentAccount;
    updateUI();
  } catch (error) {
    console.error('Failed to load accounts:', error);
  }
}

function updateUI() {
  const account = accounts.find(a => a.id === currentAccount);
  
  // 更新用户名
  const usernameEl = document.querySelector('.username');
  if (usernameEl && account) {
    usernameEl.textContent = account.username;
  } else if (usernameEl) {
    usernameEl.textContent = getI18n('account.noAccount') || '未登录';
  }
  
  // 更新账户徽章
  const badge = document.querySelector('.account-badge');
  if (badge && account) {
    if (account.type === 'microsoft') {
      badge.innerHTML = '<i class="ri-microsoft-fill"></i><span>Microsoft</span>';
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
    const selector = account.type === 'microsoft' ? '.type-icon.microsoft' : '.type-icon.offline';
    const activeItem = document.querySelector(selector)?.closest('.type-item');
    if (activeItem) {
      activeItem.classList.add('active');
      const check = document.createElement('i');
      check.className = 'ri-check-line check';
      activeItem.appendChild(check);
    }
  }
}

function updateSkinPreview(account) {
  const skinCard = document.querySelector('.skin-card');
  if (!skinCard) return;
  
  if (account) {
    // 尝试获取头像
    ipcRenderer.invoke('get-account-avatar', account.id).then(result => {
      if (result.success && result.avatarPath) {
        // 显示头像
        const avatarUrl = `file://${result.avatarPath}`;
        skinCard.innerHTML = `
          <div class="skin-preview">
            <img src="${avatarUrl}" alt="Avatar" class="skin-image avatar-image">
            <div class="avatar-label">头像预览</div>
          </div>
        `;
      } else if (account.skin) {
        // 显示完整皮肤
        let skinUrl = account.skin;
        if (skinUrl && !skinUrl.startsWith('http') && fs.existsSync(skinUrl)) {
          skinUrl = `file://${skinUrl}`;
        }
        
        skinCard.innerHTML = `
          <div class="skin-preview">
            <img src="${skinUrl}" alt="Skin" class="skin-image">
            <div class="avatar-label">皮肤预览</div>
          </div>
        `;
      } else {
        // 无皮肤
        skinCard.innerHTML = `
          <div class="skin-placeholder">
            <i class="ri-body-scan-line"></i>
            <span data-i18n="account.noSkin">${getI18n('account.noSkin') || '暂无皮肤'}</span>
          </div>
        `;
      }
    }).catch(() => {
      // 获取头像失败，显示占位符
      skinCard.innerHTML = `
        <div class="skin-placeholder">
          <i class="ri-body-scan-line"></i>
          <span data-i18n="account.noSkin">${getI18n('account.noSkin') || '暂无皮肤'}</span>
        </div>
      `;
    });
  } else {
    // 无账户
    skinCard.innerHTML = `
      <div class="skin-placeholder">
        <i class="ri-body-scan-line"></i>
        <span data-i18n="account.noSkin">${getI18n('account.noSkin') || '暂无皮肤'}</span>
      </div>
    `;
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
  
  showToast(getI18n('account.refreshing') || '正在刷新...', 'success');
  
  if (account.type === 'microsoft') {
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
  showToast(getI18n('account.loggingIn') || '正在打开登录页面...', 'success');
  
  const result = await ipcRenderer.invoke('microsoft-login');
  
  if (result.success) {
    accounts = (await ipcRenderer.invoke('get-accounts')).accounts;
    currentAccount = result.currentAccount || result.account.id;
    updateUI();
    showToast(getI18n('account.loginSuccess') || '登录成功', 'success');
    
    // 通知主窗口更新
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ 
        action: 'avatar-updated', 
        accountId: currentAccount 
      }, '*');
    }
  } else {
    if (result.error !== '用户取消登录') {
      showToast(result.error || getI18n('account.loginFailed') || '登录失败', 'error');
    }
  }
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
  
  const accountsHtml = accounts.map(acc => `
    <button class="dialog-option account-option ${acc.id === currentAccount ? 'active' : ''}" data-id="${acc.id}">
      <div class="option-icon ${acc.type}">
        <i class="${acc.type === 'microsoft' ? 'ri-microsoft-fill' : 'ri-user-line'}"></i>
      </div>
      <div class="option-text">
        <span class="option-title">${acc.username}</span>
        <span class="option-desc">${acc.type === 'microsoft' ? 'Microsoft' : (getI18n('account.offline') || '离线')}</span>
      </div>
      ${acc.id === currentAccount ? '<i class="ri-check-line current-check"></i>' : ''}
    </button>
  `).join('');
  
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
        currentAccount = result.currentAccount;
        updateUI();
        showToast(getI18n('account.switchSuccess') || '切换成功', 'success');
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
  
  if (account.type === 'microsoft') {
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
