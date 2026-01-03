// Settings Page Script
// 使用 tauri-bridge.js 提供的全局 ipcRenderer, fs, path

let appConfig = {};
let i18nData = {};
let launcherSettings = {};

// 预设主题 - 更多精美配色
const themePresets = {
  // 经典主题
  pink: {
    nameKey: 'theme.pink',
    accentColor: '#f472b6',
    gradientColors: ['#f472b6', '#ec4899', '#db2777']
  },
  purple: {
    nameKey: 'theme.purple',
    accentColor: '#a78bfa',
    gradientColors: ['#a78bfa', '#8b5cf6', '#7c3aed']
  },
  blue: {
    nameKey: 'theme.blue',
    accentColor: '#60a5fa',
    gradientColors: ['#60a5fa', '#3b82f6', '#2563eb']
  },
  cyan: {
    nameKey: 'theme.cyan',
    accentColor: '#22d3ee',
    gradientColors: ['#22d3ee', '#06b6d4', '#0891b2']
  },
  green: {
    nameKey: 'theme.green',
    accentColor: '#4ade80',
    gradientColors: ['#4ade80', '#22c55e', '#16a34a']
  },
  // 渐变主题
  sunset: {
    nameKey: 'theme.sunset',
    accentColor: '#fb923c',
    gradientColors: ['#fbbf24', '#f59e0b', '#ea580c']
  },
  rose: {
    nameKey: 'theme.rose',
    accentColor: '#fb7185',
    gradientColors: ['#fda4af', '#fb7185', '#e11d48']
  },
  aurora: {
    nameKey: 'theme.aurora',
    accentColor: '#34d399',
    gradientColors: ['#6ee7b7', '#34d399', '#059669', '#0d9488']
  },
  ocean: {
    nameKey: 'theme.ocean',
    accentColor: '#38bdf8',
    gradientColors: ['#7dd3fc', '#38bdf8', '#0284c7', '#0369a1']
  },
  lavender: {
    nameKey: 'theme.lavender',
    accentColor: '#c4b5fd',
    gradientColors: ['#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6']
  },
  // 特殊主题
  neon: {
    nameKey: 'theme.neon',
    accentColor: '#f0abfc',
    gradientColors: ['#f0abfc', '#e879f9', '#d946ef', '#a855f7']
  },
  fire: {
    nameKey: 'theme.fire',
    accentColor: '#f97316',
    gradientColors: ['#fcd34d', '#f97316', '#ea580c', '#dc2626']
  },
  mint: {
    nameKey: 'theme.mint',
    accentColor: '#5eead4',
    gradientColors: ['#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6']
  },
  peach: {
    nameKey: 'theme.peach',
    accentColor: '#fca5a5',
    gradientColors: ['#fecaca', '#fca5a5', '#f87171', '#fb7185']
  },
  galaxy: {
    nameKey: 'theme.galaxy',
    accentColor: '#818cf8',
    gradientColors: ['#c7d2fe', '#818cf8', '#6366f1', '#4f46e5', '#7c3aed']
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
  initGameSettings();
  loadConfig();
  loadLauncherSettings();
  initAutoSave();
  initMessageListener();
}

// 监听来自父窗口的消息
function initMessageListener() {
  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'reload-i18n') {
      console.log('[Settings] Received reload-i18n message');
      // 重新加载语言
      const language = appConfig.app?.language || 'zh-CN';
      await loadI18n(language);
      // 重新生成主题卡片以更新名称
      generateThemeCards();
      // 重新选中当前主题
      const currentTheme = document.getElementById('theme-preset')?.value || 'pink';
      document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === currentTheme);
      });
    }
  });
}

// 初始化自动保存
function initAutoSave() {
  // 监听所有设置变化，自动保存
  const autoSaveFields = [
    'border-radius', 'radius-size', 
    'window-width', 'window-height', 'scrollbar', 'animations',
    'theme-preset', 'accent-color'
  ];
  
  autoSaveFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', debounce(autoSaveConfig, 500));
      if (el.type === 'range' || el.type === 'color') {
        el.addEventListener('input', debounce(autoSaveConfig, 500));
      }
    }
  });
  
  // 语言切换单独处理，需要通知父窗口刷新
  const languageSelect = document.getElementById('language');
  if (languageSelect) {
    languageSelect.addEventListener('change', debounce(async () => {
      await autoSaveConfig();
      const newLanguage = languageSelect.value;
      // 重新加载当前页面的语言
      await loadI18n(newLanguage);
      // 重新生成主题卡片
      generateThemeCards();
      // 重新选中当前主题
      const currentTheme = document.getElementById('theme-preset')?.value || 'pink';
      document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === currentTheme);
      });
      // 通知父窗口语言已更改
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ action: 'language-changed', language: newLanguage }, '*');
      }
    }, 500));
  }
}

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 自动保存配置
async function autoSaveConfig() {
  const theme = getCurrentTheme();
  console.log('[Settings] Current theme:', theme);
  
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

  console.log('[Settings] Saving config:', JSON.stringify(newConfig, null, 2));

  try {
    const result = await ipcRenderer.invoke('save-config', newConfig);
    console.log('[Settings] Save result:', result);
    if (result.success) {
      console.log('[Settings] Auto-saved config successfully');
      appConfig = newConfig;
      ipcRenderer.send('config-updated', newConfig);
      
      // 通知父窗口更新主题
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ action: 'config-updated', config: newConfig }, '*');
      }
    } else {
      console.error('[Settings] Auto-save failed:', result.error);
    }
  } catch (error) {
    console.error('[Settings] Auto-save error:', error);
  }
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
  // 设置已改为自动保存，移除保存按钮事件
  document.getElementById('reset-settings')?.addEventListener('click', resetSettings);

  // 圆角联动
  document.getElementById('border-radius')?.addEventListener('change', updateRadiusState);

  // 滑块实时更新
  document.getElementById('radius-size')?.addEventListener('input', (e) => {
    document.getElementById('radius-value').textContent = e.target.value;
  });

  // 生成主题卡片
  generateThemeCards();

  // 自定义颜色
  document.getElementById('accent-color')?.addEventListener('input', (e) => {
    document.getElementById('accent-color-value').textContent = e.target.value;
    // 选中自定义主题
    selectTheme('custom');
  });
  
  // 数字输入框箭头按钮
  initNumberInputButtons();
}

// 生成主题卡片
function generateThemeCards() {
  const grid = document.getElementById('theme-grid');
  if (!grid) return;
  
  let html = '';
  
  // 添加预设主题
  for (const [key, theme] of Object.entries(themePresets)) {
    const gradient = `linear-gradient(135deg, ${theme.gradientColors.join(', ')})`;
    const themeName = getI18n(theme.nameKey) || key;
    html += `
      <div class="theme-card" data-theme="${key}">
        <div class="theme-card-preview" style="background: ${gradient}">
          <div class="theme-card-check">
            <i class="ri-check-line"></i>
          </div>
        </div>
        <div class="theme-card-name">${themeName}</div>
      </div>
    `;
  }
  
  // 添加自定义主题卡片
  const customName = getI18n('theme.custom') || '自定义';
  html += `
    <div class="theme-card" data-theme="custom">
      <div class="theme-card-preview theme-card-custom">
        <i class="ri-palette-line"></i>
      </div>
      <div class="theme-card-name">${customName}</div>
    </div>
  `;
  
  grid.innerHTML = html;
  
  // 绑定点击事件
  grid.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
      const theme = card.dataset.theme;
      selectTheme(theme);
    });
  });
}

// 选择主题
function selectTheme(themeKey) {
  console.log('[Settings] selectTheme called with:', themeKey);
  
  // 更新选中状态
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === themeKey);
  });
  
  // 更新隐藏的 input
  const presetInput = document.getElementById('theme-preset');
  if (presetInput) {
    presetInput.value = themeKey;
    console.log('[Settings] Updated theme-preset input to:', presetInput.value);
  }
  
  // 显示/隐藏自定义颜色选择器
  const customCard = document.getElementById('custom-theme-card');
  if (customCard) {
    customCard.style.display = themeKey === 'custom' ? 'block' : 'none';
  }
  
  // 如果不是自定义主题，更新颜色输入框
  if (themeKey !== 'custom' && themePresets[themeKey]) {
    const colorInput = document.getElementById('accent-color');
    const colorValue = document.getElementById('accent-color-value');
    if (colorInput) {
      colorInput.value = themePresets[themeKey].accentColor;
    }
    if (colorValue) {
      colorValue.textContent = themePresets[themeKey].accentColor;
    }
    
    // 立即在设置页面应用主题预览
    applyThemeLocally(themePresets[themeKey]);
  }
  
  // 触发主题切换动画
  triggerThemeTransition();
  
  // 自动保存
  autoSaveConfig();
}

// 在设置页面本地应用主题（预览）
function applyThemeLocally(theme) {
  const root = document.documentElement;
  
  if (theme.accentColor) {
    root.style.setProperty('--accent', theme.accentColor);
    root.style.setProperty('--accent-soft', hexToRgba(theme.accentColor, 0.12));
  }
  
  if (theme.gradientColors?.length > 0) {
    const gradient = theme.gradientColors.join(', ');
    root.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${gradient})`);
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 主题切换动画
function triggerThemeTransition() {
  // 在根元素添加过渡类
  document.documentElement.classList.add('theme-transitioning');
  
  // 通知父窗口也添加过渡
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ action: 'theme-transition-start' }, '*');
  }
  
  // 动画结束后移除类
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning');
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ action: 'theme-transition-end' }, '*');
    }
  }, 400);
}

function initNumberInputButtons() {
  document.querySelectorAll('.num-input-wrap').forEach(wrap => {
    const input = wrap.querySelector('.num-input');
    const upBtn = wrap.querySelector('.num-btn.up');
    const downBtn = wrap.querySelector('.num-btn.down');
    
    if (!input) return;
    
    const step = parseInt(input.step) || 1;
    const min = parseInt(input.min) || 0;
    const max = parseInt(input.max) || 99999;
    
    upBtn?.addEventListener('click', () => {
      const current = parseInt(input.value) || min;
      input.value = Math.min(current + step, max);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    
    downBtn?.addEventListener('click', () => {
      const current = parseInt(input.value) || min;
      input.value = Math.max(current - step, min);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function updateRadiusState() {
  const enabled = document.getElementById('border-radius').checked;
  document.getElementById('radius-row')?.classList.toggle('disabled', !enabled);
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
  
  const accentColor = appConfig.theme?.accentColor || '#f472b6';
  document.getElementById('accent-color').value = accentColor;
  document.getElementById('accent-color-value').textContent = accentColor;
  
  // 选中对应的主题卡片
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === themePreset);
  });
  
  // 显示/隐藏自定义颜色选择器
  const customCard = document.getElementById('custom-theme-card');
  if (customCard) {
    customCard.style.display = themePreset === 'custom' ? 'block' : 'none';
  }
  
  updateRadiusState();
}

function getCurrentTheme() {
  const preset = document.getElementById('theme-preset')?.value || 'pink';
  console.log('[Settings] getCurrentTheme - preset:', preset);
  
  if (preset === 'custom') {
    const color = document.getElementById('accent-color')?.value || '#f472b6';
    const theme = {
      preset: 'custom',
      accentColor: color,
      gradientColors: [color, adjustColor(color, -15), adjustColor(color, -30)]
    };
    console.log('[Settings] getCurrentTheme - returning custom theme:', theme);
    return theme;
  }
  
  // 返回预设主题的数据（不包含 name）
  const themeData = themePresets[preset];
  if (themeData) {
    const theme = {
      preset,
      accentColor: themeData.accentColor,
      gradientColors: themeData.gradientColors
    };
    console.log('[Settings] getCurrentTheme - returning preset theme:', theme);
    return theme;
  }
  
  // 默认返回 pink 主题
  console.log('[Settings] getCurrentTheme - returning default pink theme');
  return {
    preset: 'pink',
    accentColor: '#f472b6',
    gradientColors: ['#f472b6', '#ec4899', '#db2777']
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


// ═══════════════════════════════════════════════════════════
// 游戏设置
// ═══════════════════════════════════════════════════════════

function initGameSettings() {
  // 选择 .minecraft 目录
  document.getElementById('select-mc-dir')?.addEventListener('click', selectMinecraftDir);
  
  // 选择 Java
  document.getElementById('select-java')?.addEventListener('click', selectJava);
  
  // 内存和窗口大小变化时自动保存
  ['game-memory-min', 'game-memory-max', 'game-window-width', 'game-window-height'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', saveLauncherSettings);
  });
  
  // 启动器行为选择
  document.getElementById('launcher-behavior')?.addEventListener('change', (e) => {
    updateLauncherBehaviorHint(e.target.value);
    saveLauncherBehavior(e.target.value);
  });
}

function updateLauncherBehaviorHint(behavior) {
  const hintBlock = document.getElementById('launcher-behavior-hint');
  if (!hintBlock) return;
  
  const hintKey = `settings.behaviorHints.${behavior.replace(/-/g, '')}`;
  // 尝试从 i18n 获取，如果没有则使用默认
  let hint = getI18n(`settings.behaviorHints.${behavior === 'keep-front' ? 'keepFront' : 
                      behavior === 'auto-hide' ? 'autoHide' : 
                      behavior === 'hide-when-game-front' ? 'hideWhenGameFront' : 'autoExit'}`);
  
  if (!hint) {
    const hints = {
      'keep-front': '保持前台：启动器保持显示，不做任何操作',
      'auto-hide': '自动隐藏：游戏启动后启动器自动隐藏，需手动打开',
      'hide-when-game-front': '游戏在前台时隐藏：游戏运行时隐藏，游戏关闭后自动显示',
      'auto-exit': '自动退出：游戏启动后启动器自动退出'
    };
    hint = hints[behavior] || hints['keep-front'];
  }
  
  const span = hintBlock.querySelector('span');
  if (span) {
    span.textContent = hint;
  }
}

async function saveLauncherBehavior(behavior) {
  try {
    await ipcRenderer.invoke('set-launcher-behavior', behavior);
  } catch (error) {
    console.error('Save launcher behavior error:', error);
  }
}

async function loadLauncherSettings() {
  try {
    console.log('[Settings] Loading launcher settings...');
    launcherSettings = await ipcRenderer.invoke('get-launcher-settings');
    console.log('[Settings] Received settings:', JSON.stringify(launcherSettings, null, 2));
    populateLauncherSettings();
    
    // 加载启动器行为设置
    const behavior = await ipcRenderer.invoke('get-launcher-behavior');
    console.log('[Settings] Launcher behavior:', behavior);
    const behaviorSelect = document.getElementById('launcher-behavior');
    if (behaviorSelect) {
      behaviorSelect.value = behavior || 'keep-front';
      updateLauncherBehaviorHint(behavior || 'keep-front');
    }
  } catch (error) {
    console.error('Failed to load launcher settings:', error);
  }
}

function populateLauncherSettings() {
  console.log('[Settings] Populating launcher settings:', launcherSettings);
  
  // .minecraft 目录 - 处理 snake_case 和 camelCase
  const mcDirPath = document.getElementById('mc-dir-path');
  if (mcDirPath) {
    const minecraftDir = launcherSettings.minecraft_dir || launcherSettings.minecraftDir;
    if (minecraftDir) {
      mcDirPath.textContent = minecraftDir;
      mcDirPath.title = minecraftDir;
      console.log('[Settings] Minecraft dir:', minecraftDir);
    } else {
      mcDirPath.textContent = '未设置';
      console.log('[Settings] Minecraft dir not set');
    }
  }
  
  // Java 路径 - 处理 snake_case 和 camelCase
  const javaPathEl = document.getElementById('java-path');
  if (javaPathEl) {
    const javaPath = launcherSettings.java_path || launcherSettings.javaPath;
    if (javaPath) {
      javaPathEl.textContent = javaPath;
      javaPathEl.title = javaPath;
      console.log('[Settings] Java path:', javaPath);
    } else {
      javaPathEl.textContent = '未设置';
      console.log('[Settings] Java path not set');
    }
  }
  
  // 内存设置
  const memMin = launcherSettings.memory?.min || 512;
  const memMax = launcherSettings.memory?.max || 2048;
  document.getElementById('game-memory-min').value = memMin;
  document.getElementById('game-memory-max').value = memMax;
  console.log('[Settings] Memory:', memMin, '-', memMax);
  
  // 游戏窗口大小 - 处理 snake_case 和 camelCase
  const windowSize = launcherSettings.window_size || launcherSettings.windowSize || {};
  document.getElementById('game-window-width').value = windowSize.width || 854;
  document.getElementById('game-window-height').value = windowSize.height || 480;
  console.log('[Settings] Window size:', windowSize.width || 854, 'x', windowSize.height || 480);
}

async function selectMinecraftDir() {
  try {
    const result = await ipcRenderer.invoke('select-minecraft-dir');
    if (result.success) {
      launcherSettings.minecraftDir = result.path;
      populateLauncherSettings();
      showToast('.minecraft 目录已设置', 'success');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    console.error('Select minecraft dir error:', error);
    showToast('选择目录失败', 'error');
  }
}

async function selectJava() {
  // 先检测系统中的 Java
  try {
    const detectResult = await ipcRenderer.invoke('detect-java');
    
    if (detectResult.success && detectResult.javaList.length > 0) {
      showJavaSelectDialog(detectResult.javaList);
    } else {
      // 没有检测到，直接手动选择
      await browseJava();
    }
  } catch (error) {
    console.error('Detect java error:', error);
    await browseJava();
  }
}

function showJavaSelectDialog(javaList) {
  // 获取当前 Java 路径（处理 snake_case）
  const currentJavaPath = launcherSettings.java_path || launcherSettings.javaPath;
  console.log('[Settings] Current Java path:', currentJavaPath);
  
  // 创建对话框
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <div class="dialog-header">
        <h3>选择 Java</h3>
        <button class="dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="dialog-body">
        <div class="java-list">
          ${javaList.map(java => `
            <div class="java-item ${currentJavaPath === java.path ? 'selected' : ''}" data-path="${java.path}">
              <div class="java-info">
                <span class="java-name">${java.name}</span>
                <span class="java-version">Java ${java.version}</span>
              </div>
              <span class="java-path-text">${java.path}</span>
            </div>
          `).join('')}
        </div>
        <button class="btn-outline-full" id="browse-java-btn">
          <i class="ri-folder-open-line"></i>
          手动选择
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  
  const closeDialog = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };
  
  // 关闭按钮
  overlay.querySelector('.dialog-close')?.addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  
  // Java 项点击
  overlay.querySelectorAll('.java-item').forEach(item => {
    item.addEventListener('click', async () => {
      const javaPath = item.dataset.path;
      console.log('[Settings] Selected Java:', javaPath);
      
      const result = await ipcRenderer.invoke('set-java-path', javaPath);
      console.log('[Settings] Set Java result:', result);
      
      if (result.success) {
        // 更新本地设置（使用 snake_case 以匹配 Rust）
        launcherSettings.java_path = javaPath;
        populateLauncherSettings();
        closeDialog();
        showToast('Java 已设置', 'success');
      } else {
        showToast(result.error || '设置失败', 'error');
      }
    });
  });
  
  // 手动选择
  overlay.querySelector('#browse-java-btn')?.addEventListener('click', async () => {
    closeDialog();
    await browseJava();
  });
}

async function browseJava() {
  try {
    console.log('[Settings] Browsing for Java...');
    const result = await ipcRenderer.invoke('select-java-path');
    console.log('[Settings] Browse Java result:', result);
    
    if (result.success) {
      // 更新本地设置（使用 snake_case 以匹配 Rust）
      launcherSettings.java_path = result.path;
      populateLauncherSettings();
      showToast(`Java ${result.version} 已设置`, 'success');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    console.error('Browse java error:', error);
    showToast('选择 Java 失败', 'error');
  }
}

async function saveLauncherSettings() {
  const settings = {
    memory: {
      min: parseInt(document.getElementById('game-memory-min')?.value) || 512,
      max: parseInt(document.getElementById('game-memory-max')?.value) || 2048
    },
    windowSize: {
      width: parseInt(document.getElementById('game-window-width')?.value) || 854,
      height: parseInt(document.getElementById('game-window-height')?.value) || 480
    }
  };
  
  try {
    await ipcRenderer.invoke('save-launcher-settings', settings);
    launcherSettings = { ...launcherSettings, ...settings };
  } catch (error) {
    console.error('Save launcher settings error:', error);
  }
}
