// Home Page Script - 简洁实用版
// 使用 tauri-bridge.js 提供的全局 ipcRenderer

let versions = [];
let selectedVersion = null;
let currentFilter = 'all';
let launcherSettings = {};
let isGameRunning = false;
let i18nData = {};
let currentAccount = null;
let recentPlayed = [];

// 初始化
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
    console.error('[Home] ipcRenderer not available');
    return;
  }
  
  await loadI18n();
  await loadSettings();
  await loadAccount();
  await scanVersions();
  await loadRecentPlayed();
  checkGameStatus();
  initEventListeners();
  initMessageListener();
  
  // 定时检查游戏状态
  setInterval(checkGameStatus, 5000);
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
  }
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = getI18n(key);
    if (value) el.textContent = value;
  });
  
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const value = getI18n(key);
    if (value) el.placeholder = value;
  });
}

function getI18n(key) {
  const keys = key.split('.');
  let value = i18nData;
  for (const k of keys) {
    value = value?.[k];
  }
  return value || key;
}

// ═══════════════════════════════════════════════════════════
// 数据加载
// ═══════════════════════════════════════════════════════════
async function loadSettings() {
  try {
    launcherSettings = await ipcRenderer.invoke('get-launcher-settings');
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

async function loadAccount() {
  try {
    const result = await ipcRenderer.invoke('get-accounts');
    const accounts = result.accounts || [];
    const currentId = result.current_account;
    
    currentAccount = accounts.find(a => a.id === currentId) || null;
    updateAccountDisplay();
  } catch (error) {
    console.error('Failed to load account:', error);
  }
}

function updateAccountDisplay() {
  const avatarEl = document.getElementById('account-avatar');
  const nameEl = document.getElementById('account-name');
  const typeEl = document.getElementById('account-type');
  
  if (currentAccount) {
    nameEl.textContent = currentAccount.username;
    // 修复：使用 type 而不是 account_type
    const accountType = currentAccount.type || currentAccount.account_type;
    typeEl.textContent = accountType === 'microsoft' ? 'Microsoft' : getI18n('user.offline');
    
    // 加载头像
    loadAccountAvatar(currentAccount.id);
  } else {
    nameEl.textContent = getI18n('account.noAccount');
    typeEl.textContent = getI18n('user.offline');
    avatarEl.innerHTML = '<i class="ri-user-line"></i>';
  }
}

async function loadAccountAvatar(accountId) {
  try {
    const result = await ipcRenderer.invoke('get-account-avatar', accountId);
    const avatarEl = document.getElementById('account-avatar');
    
    if (result.success && result.avatarPath) {
      const timestamp = Date.now();
      // 使用 Tauri 的 convertFileSrc 转换本地路径
      let imgSrc = result.avatarPath;
      if (window.__TAURI__?.core?.convertFileSrc) {
        imgSrc = window.__TAURI__.core.convertFileSrc(result.avatarPath);
      } else if (window.parent?.__TAURI__?.core?.convertFileSrc) {
        imgSrc = window.parent.__TAURI__.core.convertFileSrc(result.avatarPath);
      }
      avatarEl.innerHTML = `<img src="${imgSrc}?t=${timestamp}" alt="avatar">`;
    }
  } catch (error) {
    console.error('Failed to load avatar:', error);
  }
}

async function scanVersions() {
  try {
    const result = await ipcRenderer.invoke('scan-versions');
    if (result.success) {
      versions = result.versions || [];
      renderVersionList();
      
      // 恢复上次选择的版本
      const lastVersion = localStorage.getItem('lastSelectedVersion');
      if (lastVersion) {
        const version = versions.find(v => v.id === lastVersion);
        if (version) {
          selectVersion(version);
        }
      }
    }
  } catch (error) {
    console.error('Failed to scan versions:', error);
  }
}

async function loadRecentPlayed() {
  try {
    const stored = localStorage.getItem('recentPlayed');
    recentPlayed = stored ? JSON.parse(stored) : [];
    renderRecentPlayed();
  } catch (error) {
    console.error('Failed to load recent played:', error);
  }
}

function saveRecentPlayed(versionId) {
  // 移除已存在的
  recentPlayed = recentPlayed.filter(r => r.id !== versionId);
  // 添加到开头
  recentPlayed.unshift({
    id: versionId,
    time: Date.now()
  });
  // 只保留最近5个
  recentPlayed = recentPlayed.slice(0, 5);
  localStorage.setItem('recentPlayed', JSON.stringify(recentPlayed));
  renderRecentPlayed();
}

function renderRecentPlayed() {
  const container = document.getElementById('recent-grid');
  const noRecent = document.getElementById('no-recent');
  
  // 如果容器不存在，直接返回（主页不需要最近游玩功能）
  if (!container) return;
  
  if (recentPlayed.length === 0) {
    if (noRecent) noRecent.style.display = 'flex';
    return;
  }
  
  if (noRecent) noRecent.style.display = 'none';
  
  // 清除旧内容（保留空提示）
  container.querySelectorAll('.recent-item').forEach(el => el.remove());
  
  recentPlayed.forEach(recent => {
    const version = versions.find(v => v.id === recent.id);
    if (!version) return;
    
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `
      <div class="recent-icon ${version.loader}">${getLoaderIcon(version.loader)}</div>
      <div class="recent-info">
        <span class="recent-name">${version.id}</span>
        <span class="recent-time">${formatTime(recent.time)}</span>
      </div>
    `;
    item.onclick = () => {
      selectVersion(version);
      launchGame();
    };
    container.appendChild(item);
  });
}

function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  
  if (hours < 1) return getI18n('home.justNow') || '刚刚';
  if (hours < 24) return `${hours} ${getI18n('home.hoursAgo') || '小时前'}`;
  if (days === 1) return getI18n('home.yesterday') || '昨天';
  return `${days} ${getI18n('home.daysAgo') || '天前'}`;
}

// ═══════════════════════════════════════════════════════════
// 版本列表
// ═══════════════════════════════════════════════════════════
function renderVersionList() {
  const container = document.getElementById('version-list');
  const searchText = document.getElementById('version-search')?.value?.toLowerCase() || '';
  
  let filtered = versions.filter(v => {
    // 搜索过滤
    if (searchText && !v.id.toLowerCase().includes(searchText)) {
      return false;
    }
    return true;
  });
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="version-loading">
        <i class="ri-folder-line"></i>
        <span>${getI18n('instances.noVersionsFound') || '没有找到版本'}</span>
      </div>
    `;
    return;
  }
  
  container.innerHTML = filtered.map(v => `
    <div class="version-item ${selectedVersion?.id === v.id ? 'selected' : ''}" data-id="${v.id}">
      <span class="version-item-name">${v.id}</span>
      <span class="version-item-type">${getVersionTypeText(v)}</span>
    </div>
  `).join('');
  
  // 绑定点击事件
  container.querySelectorAll('.version-item').forEach(item => {
    item.onclick = () => {
      const version = versions.find(v => v.id === item.dataset.id);
      if (version) {
        selectVersion(version);
        document.getElementById('version-display').classList.remove('active');
        document.getElementById('version-dropdown').classList.remove('active');
      }
    };
  });
}

function getLoaderIcon(loader) {
  // 使用MC风格的PNG图标（类似HMCL）
  const iconMap = {
    vanilla: 'grass',
    grass: 'grass',
    chest: 'chest',
    furnace: 'furnace',
    craft_table: 'craft_table',
    command: 'command',
    chicken: 'chicken',
    forge: 'forge',
    fabric: 'fabric',
    quilt: 'quilt',
    neoforge: 'neoforge',
    optifine: 'optifine'
  };
  const iconName = iconMap[loader] || 'grass';
  return `<img src="../../assets/icons/${iconName}.png" alt="${loader}" class="version-icon-img">`;
}

function getVersionTypeText(version) {
  const types = {
    release: getI18n('downloads.version.release') || '正式版',
    snapshot: getI18n('downloads.version.snapshot') || '快照',
    old_beta: 'Beta',
    old_alpha: 'Alpha'
  };
  
  if (version.loader && version.loader !== 'vanilla') {
    const loaderName = version.loader.charAt(0).toUpperCase() + version.loader.slice(1);
    return loaderName;
  }
  
  return types[version.version_type] || types['release'] || '正式版';
}

function selectVersion(version) {
  selectedVersion = version;
  document.getElementById('selected-version').textContent = version.id;
  document.getElementById('launch-btn').disabled = !version.has_jar;
  localStorage.setItem('lastSelectedVersion', version.id);
  
  // 更新列表选中状态
  document.querySelectorAll('.version-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.id === version.id);
  });
}

function closeVersionDropdown() {
  document.getElementById('version-dropdown').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════
// 游戏启动
// ═══════════════════════════════════════════════════════════
async function launchGame() {
  if (!selectedVersion || !selectedVersion.has_jar) {
    showToast(getI18n('home.selectVersion') || '请选择版本', 'error');
    return;
  }
  
  if (!currentAccount) {
    showToast(getI18n('account.noAccountToRefresh') || '请先登录账户', 'error');
    return;
  }
  
  // 显示启动弹窗
  showLaunchModal();
  
  try {
    const result = await ipcRenderer.invoke('launch-game', selectedVersion.id, currentAccount.id);
    
    if (result.success) {
      saveRecentPlayed(selectedVersion.id);
      hideLaunchModal();
      showToast(getI18n('instances.gameLaunched') || '游戏已启动', 'success');
      checkGameStatus();
    } else {
      hideLaunchModal();
      showToast(result.error || getI18n('instances.launchFailed'), 'error');
    }
  } catch (error) {
    hideLaunchModal();
    showToast(error.message || getI18n('instances.launchError'), 'error');
  }
}

function showLaunchModal() {
  const modal = document.getElementById('launch-modal');
  if (modal) {
    modal.classList.add('show');
    // 重置所有步骤
    document.querySelectorAll('.launch-step').forEach(step => {
      step.classList.remove('active', 'done', 'error');
      const detail = step.querySelector('.step-detail');
      if (detail) detail.textContent = '';
    });
  }
}

function hideLaunchModal() {
  const modal = document.getElementById('launch-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

function updateLaunchStep(step, status, message) {
  const stepEl = document.querySelector(`.launch-step[data-step="${step}"]`);
  if (!stepEl) return;
  
  // 移除所有状态
  stepEl.classList.remove('active', 'done', 'error');
  
  // 添加新状态
  if (status === 'running') {
    stepEl.classList.add('active');
  } else if (status === 'done') {
    stepEl.classList.add('done');
  } else if (status === 'error') {
    stepEl.classList.add('error');
  }
  
  // 更新详细信息
  const detail = stepEl.querySelector('.step-detail');
  if (detail && message) {
    detail.textContent = message;
  }
}

// ═══════════════════════════════════════════════════════════
// 游戏状态
// ═══════════════════════════════════════════════════════════
async function checkGameStatus() {
  try {
    const result = await ipcRenderer.invoke('get-game-status');
    isGameRunning = result.running;
    
    const statusBar = document.getElementById('game-status-bar');
    if (statusBar) {
      if (isGameRunning) {
        statusBar.style.display = 'flex';
        const statusText = document.getElementById('status-text');
        if (statusText && result.runningCount > 0) {
          statusText.textContent = `${getI18n('home.gameRunning')} (${result.runningCount})`;
        }
      } else {
        statusBar.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Failed to check game status:', error);
  }
}

async function killGame() {
  try {
    await ipcRenderer.invoke('kill-game');
    showToast(getI18n('instances.stopped') || '已停止', 'success');
    checkGameStatus();
  } catch (error) {
    showToast(getI18n('instances.stopFailed') || '停止失败', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// 事件监听
// ═══════════════════════════════════════════════════════════
function initEventListeners() {
  // 版本选择器
  const versionDisplay = document.getElementById('version-display');
  const versionDropdown = document.getElementById('version-dropdown');
  
  versionDisplay.onclick = (e) => {
    e.stopPropagation();
    versionDisplay.classList.toggle('active');
    versionDropdown.classList.toggle('active');
  };
  
  // 点击外部关闭下拉
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.version-selector')) {
      versionDisplay.classList.remove('active');
      versionDropdown.classList.remove('active');
    }
  });
  
  // 版本搜索
  const versionSearch = document.getElementById('version-search');
  if (versionSearch) {
    versionSearch.oninput = () => {
      renderVersionList();
    };
  }
  
  // 启动按钮
  document.getElementById('launch-btn').onclick = launchGame;
  
  // 停止按钮
  const btnKill = document.getElementById('btn-kill');
  if (btnKill) {
    btnKill.onclick = killGame;
  }
  
  // 账户点击
  const accountSection = document.getElementById('account-section');
  if (accountSection) {
    accountSection.onclick = (e) => {
      // 添加波纹效果
      accountSection.classList.add('ripple');
      setTimeout(() => {
        accountSection.classList.remove('ripple');
      }, 600);
      
      // 延迟跳转，让动画播放完
      setTimeout(() => {
        window.parent.postMessage({ action: 'navigate', page: 'account' }, '*');
      }, 200);
    };
  }
  
  // 监听启动步骤事件
  ipcRenderer.on('launch-step', (event, data) => {
    updateLaunchStep(data.step, data.status, data.message);
  });
  
  // 监听游戏退出
  ipcRenderer.on('game-exited', () => {
    checkGameStatus();
  });
  
  ipcRenderer.on('all-games-exited', () => {
    checkGameStatus();
  });
}

function initMessageListener() {
  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'reload-i18n') {
      await loadI18n();
    } else if (event.data?.action === 'config-updated' && event.data.config) {
      applyTheme(event.data.config.theme);
    } else if (event.data?.action === 'account-updated' || event.data?.action === 'avatar-updated') {
      // 账户切换或头像更新时刷新账户显示
      await loadAccount();
    } else if (event.data?.action === 'launch-step') {
      updateLaunchStep(event.data.step, event.data.status, event.data.message);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 主题
// ═══════════════════════════════════════════════════════════
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
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ═══════════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="ri-${type === 'success' ? 'check' : type === 'error' ? 'close' : 'information'}-line"></i>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}
