// About Page Script
// 使用 tauri-bridge.js 提供的全局对象

let i18nData = {};
let appConfig = {};

console.log('[About] Script loaded');
console.log('[About] window.VersionLoader exists:', !!window.VersionLoader);
console.log('[About] window.VersionLoader:', window.VersionLoader);

// 确保 VersionLoader 可用
if (!window.VersionLoader) {
  console.error('[About] CRITICAL: VersionLoader not found on window object!');
  console.log('[About] Available window properties:', Object.keys(window).filter(k => k.includes('Version')));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  console.log('[About] init() called');
  console.log('[About] Checking VersionLoader again:', !!window.VersionLoader);
  
  if (!window.VersionLoader) {
    console.error('[About] VersionLoader not found! This should not happen.');
    console.error('[About] Script load order issue detected.');
    return;
  }
  
  await loadVersionInfo();
  loadConfig();
  initMessageListener();
}

// 加载版本信息
async function loadVersionInfo() {
  console.log('[About] loadVersionInfo() called');
  console.log('[About] VersionLoader available:', !!window.VersionLoader);
  
  if (!window.VersionLoader) {
    console.error('[About] Cannot load version info: VersionLoader is undefined');
    return;
  }
  
  try {
    console.log('[About] Calling VersionLoader.load()...');
    await window.VersionLoader.load();
    console.log('[About] VersionLoader.load() completed');
    
    // 获取版本信息
    const version = window.VersionLoader.getVersion();
    const channel = window.VersionLoader.getChannel();
    const ui = window.VersionLoader.getUIVersion();
    const dev = window.VersionLoader.getDeveloper();
    
    console.log('[About] Retrieved version data:', {
      version,
      channel,
      ui,
      dev
    });
    
    // 更新页面显示
    const softwareVersion = document.getElementById('software-version');
    const versionChannel = document.getElementById('version-channel');
    const uiVersion = document.getElementById('ui-version');
    const developer = document.getElementById('developer');
    
    if (softwareVersion) {
      softwareVersion.textContent = version;
      console.log('[About] Updated software-version element to:', version);
    } else {
      console.error('[About] software-version element not found');
    }
    
    if (versionChannel) {
      const channelLabel = window.VersionLoader.getChannelLabel(channel);
      versionChannel.textContent = channelLabel;
      versionChannel.className = `version-tag ${channel}`;
      console.log('[About] Updated version-channel element to:', channelLabel);
    } else {
      console.error('[About] version-channel element not found');
    }
    
    if (uiVersion) {
      uiVersion.textContent = ui;
      console.log('[About] Updated ui-version element to:', ui);
    } else {
      console.error('[About] ui-version element not found');
    }
    
    if (developer) {
      developer.textContent = dev;
      console.log('[About] Updated developer element to:', dev);
    } else {
      console.error('[About] developer element not found');
    }
    
    // 更新版本通道列表的选中状态
    updateChannelListSelection(channel);
    
    console.log('[About] Version info loaded and displayed successfully');
  } catch (error) {
    console.error('[About] Failed to load version info:', error);
    console.error('[About] Error stack:', error.stack);
  }
}

// 监听来自父窗口的消息
function initMessageListener() {
  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'reload-i18n') {
      console.log('[About] Received reload-i18n message');
      await loadConfig();
    } else if (event.data?.action === 'config-updated' && event.data.config) {
      // 应用主题
      applyTheme(event.data.config.theme);
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

async function loadConfig() {
  try {
    appConfig = await ipcRenderer.invoke('get-config');
    const language = appConfig.app?.language || 'zh-CN';
    await loadI18n(language);
  } catch (error) {
    console.error('Failed to load config:', error);
    await loadI18n('zh-CN');
  }
}

async function loadI18n(language) {
  try {
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
}

function getI18n(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], i18nData);
}

// 根据当前版本通道更新列表选中状态
function updateChannelListSelection(channel) {
  const channelLower = (channel || 'alpha').toLowerCase();
  console.log('[About] Updating channel list selection to:', channelLower);
  
  // 移除所有 active 状态
  document.querySelectorAll('.channel-item').forEach(item => {
    item.classList.remove('active');
    // 移除勾选图标
    const checkIcon = item.querySelector('.channel-current');
    if (checkIcon) {
      checkIcon.remove();
    }
  });
  
  // 根据 channel 找到对应的项并添加 active
  const channelMap = {
    'release': 0,
    'stable': 0,
    'beta': 1,
    'alpha': 2
  };
  
  const index = channelMap[channelLower] ?? 2;
  const channelItems = document.querySelectorAll('.channel-item');
  
  if (channelItems[index]) {
    channelItems[index].classList.add('active');
    // 添加勾选图标
    const checkIcon = document.createElement('i');
    checkIcon.className = 'ri-checkbox-circle-fill channel-current';
    channelItems[index].appendChild(checkIcon);
    console.log('[About] Set channel item', index, 'as active');
  }
}
