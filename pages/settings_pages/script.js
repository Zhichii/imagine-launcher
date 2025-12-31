// Settings Page Script
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let appConfig = {};
let i18nData = {};

// 预设主题
const themePresets = {
  blue: {
    accentColor: '#3b82f6',
    gradientColors: ['#3b82f6', '#8b5cf6', '#a855f7']
  },
  pink: {
    accentColor: '#d7bbec',
    gradientColors: ['#d7bbec', '#e4bbec', '#ecbbe8', '#ecbbdc', '#ecbbcf']
  },
  green: {
    accentColor: '#22c55e',
    gradientColors: ['#22c55e', '#10b981', '#14b8a6']
  },
  orange: {
    accentColor: '#f59e0b',
    gradientColors: ['#f59e0b', '#f97316', '#ef4444']
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  initNavigation();
  initBackButton();
  initControls();
  loadConfig();
}

// 设置页内导航
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      
      // 更新导航状态
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      // 切换内容区
      document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
      document.getElementById(`section-${section}`)?.classList.add('active');
    });
  });
}

function initBackButton() {
  document.getElementById('back-to-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ action: 'back-to-home' }, '*');
    }
  });
}

function initControls() {
  document.getElementById('save-settings')?.addEventListener('click', saveSettings);
  document.getElementById('reset-settings')?.addEventListener('click', resetSettings);

  // 圆角联动
  document.getElementById('border-radius')?.addEventListener('change', updateRadiusState);

  // 滑块实时更新
  document.getElementById('radius-size')?.addEventListener('input', (e) => {
    document.getElementById('radius-value').textContent = e.target.value;
  });

  // 主题预设切换
  document.getElementById('theme-preset')?.addEventListener('change', (e) => {
    updateThemePreset(e.target.value);
  });

  // 自定义颜色
  document.getElementById('accent-color')?.addEventListener('input', (e) => {
    document.getElementById('accent-color-value').textContent = e.target.value;
    updateThemePreview();
  });
}

function updateRadiusState() {
  const enabled = document.getElementById('border-radius').checked;
  document.getElementById('radius-row')?.classList.toggle('disabled', !enabled);
}

function updateThemePreset(preset) {
  const customCard = document.getElementById('custom-theme-card');
  const colorInput = document.getElementById('accent-color');
  
  if (preset === 'custom') {
    customCard?.classList.remove('disabled');
  } else {
    customCard?.classList.add('disabled');
    
    if (themePresets[preset] && colorInput) {
      colorInput.value = themePresets[preset].accentColor;
      document.getElementById('accent-color-value').textContent = themePresets[preset].accentColor;
    }
  }
  
  updateThemePreview();
}

function updateThemePreview() {
  const preview = document.getElementById('theme-preview');
  const preset = document.getElementById('theme-preset')?.value;
  
  if (!preview) return;
  
  let gradient;
  if (preset === 'custom') {
    const color = document.getElementById('accent-color')?.value || '#d7bbec';
    gradient = `linear-gradient(135deg, ${color}, ${adjustColor(color, -20)})`;
  } else if (themePresets[preset]) {
    const colors = themePresets[preset].gradientColors;
    gradient = `linear-gradient(135deg, ${colors.join(', ')})`;
  }
  
  if (gradient) {
    preview.style.background = gradient;
  }
}

function adjustColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

async function loadConfig() {
  try {
    appConfig = await ipcRenderer.invoke('get-config');
    await loadI18n(appConfig.app?.language || 'zh-CN');
    populateSettings();
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

async function loadI18n(language) {
  try {
    const i18nPath = path.join(__dirname, '../../locales', `${language}.json`);
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

function populateSettings() {
  if (!appConfig.app) return;

  document.getElementById('language').value = appConfig.app.language || 'zh-CN';
  document.getElementById('border-radius').checked = appConfig.window?.borderRadius ?? true;
  document.getElementById('radius-size').value = appConfig.window?.radiusSize ?? 12;
  document.getElementById('radius-value').textContent = appConfig.window?.radiusSize ?? 12;
  document.getElementById('window-width').value = appConfig.window?.width ?? 1000;
  document.getElementById('window-height').value = appConfig.window?.height ?? 600;
  document.getElementById('scrollbar').checked = appConfig.ui?.scrollbar ?? false;
  document.getElementById('animations').checked = appConfig.ui?.animations ?? true;

  // 主题设置
  const themePreset = appConfig.theme?.preset || 'pink';
  document.getElementById('theme-preset').value = themePreset;
  
  const accentColor = appConfig.theme?.accentColor || '#d7bbec';
  document.getElementById('accent-color').value = accentColor;
  document.getElementById('accent-color-value').textContent = accentColor;
  
  updateThemePreset(themePreset);
  updateRadiusState();
}

function getCurrentTheme() {
  const preset = document.getElementById('theme-preset')?.value || 'pink';
  
  if (preset === 'custom') {
    const color = document.getElementById('accent-color')?.value || '#d7bbec';
    return {
      preset: 'custom',
      accentColor: color,
      gradientColors: [color, adjustColor(color, -15), adjustColor(color, -30)]
    };
  }
  
  return {
    preset,
    ...themePresets[preset]
  };
}

async function saveSettings() {
  const theme = getCurrentTheme();
  
  const newConfig = {
    app: {
      name: 'ImagineLauncher',
      version: appConfig.app?.version || '0.0.1',
      uiFrameworkVersion: appConfig.app?.uiFrameworkVersion || '1.0.1',
      channel: appConfig.app?.channel || 'Alpha',
      language: document.getElementById('language').value
    },
    window: {
      width: parseInt(document.getElementById('window-width').value) || 1000,
      height: parseInt(document.getElementById('window-height').value) || 600,
      minWidth: appConfig.window?.minWidth || 800,
      minHeight: appConfig.window?.minHeight || 500,
      borderRadius: document.getElementById('border-radius').checked,
      radiusSize: parseInt(document.getElementById('radius-size').value) || 12
    },
    ui: {
      scrollbar: document.getElementById('scrollbar').checked,
      titlebarHeight: 48,
      animations: document.getElementById('animations').checked
    },
    theme
  };

  try {
    const result = await ipcRenderer.invoke('save-config', newConfig);
    if (result.success) {
      showToast(getI18n('settings.saved') || '设置已保存', 'success');
      appConfig = newConfig;
      ipcRenderer.send('config-updated', newConfig);
    } else {
      showToast((getI18n('settings.saveFailed') || '保存失败') + ': ' + result.error, 'error');
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
    showToast(getI18n('settings.saveFailed') || '保存失败', 'error');
  }
}

function resetSettings() {
  appConfig = {
    app: { 
      name: 'ImagineLauncher', 
      version: '0.0.1', 
      uiFrameworkVersion: '1.0.1',
      channel: 'Alpha',
      language: 'zh-CN' 
    },
    window: { 
      width: 1000, 
      height: 600, 
      minWidth: 800, 
      minHeight: 500, 
      borderRadius: true, 
      radiusSize: 12 
    },
    ui: { 
      scrollbar: false, 
      titlebarHeight: 48, 
      animations: true 
    },
    theme: {
      preset: 'pink',
      accentColor: '#d7bbec',
      gradientColors: ['#d7bbec', '#e4bbec', '#ecbbe8', '#ecbbdc', '#ecbbcf']
    }
  };

  populateSettings();
  showToast(getI18n('settings.resetDone') || '已恢复默认设置', 'success');
}

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
