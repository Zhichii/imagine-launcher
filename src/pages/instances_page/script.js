// Instances Page Script
// 使用 tauri-bridge.js 提供的全局 ipcRenderer 和 path

let minecraftDirs = [];
let currentDirIndex = 0;
let versions = [];
let versionSettings = {};
let currentFilter = 'all';
let searchText = '';
let editingVersionId = null;
let javaList = [];
let currentLayout = 'auto'; // auto, grid, list
let runningInstances = []; // 运行中的实例
let i18nData = {};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  initEventListeners();
  await loadI18n();
  await loadSettings();
  await loadLayoutSetting();
  await loadRunningInstances();
  renderDirTabs();
  await scanCurrentDir();
  initMessageListener();
  
  // 监听实例状态变化
  ipcRenderer.on('instance-started', (event, data) => {
    console.log('[Instances] Instance started:', data);
    runningInstances.push(data);
    updateRunningInstancesButton();
    renderVersions();
  });
  
  ipcRenderer.on('instance-exited', (event, data) => {
    console.log('[Instances] Instance exited:', data);
    runningInstances = runningInstances.filter(i => i.pid !== data.pid);
    updateRunningInstancesButton();
    renderVersions();
  });
  
  // 监听所有游戏退出事件
  ipcRenderer.on('all-games-exited', (event, data) => {
    console.log('[Instances] All games exited');
    runningInstances = [];
    updateRunningInstancesButton();
    renderVersions();
  });
  
  // 监听来自父窗口的消息
  window.addEventListener('message', (event) => {
    if (event.data?.action === 'instance-exited') {
      console.log('[Instances] Instance exited (from parent):', event.data);
      runningInstances = runningInstances.filter(i => i.pid !== event.data.pid);
      updateRunningInstancesButton();
      renderVersions();
    } else if (event.data?.action === 'all-games-exited') {
      console.log('[Instances] All games exited (from parent)');
      runningInstances = [];
      updateRunningInstancesButton();
      renderVersions();
    } else if (event.data?.action === 'game-exited') {
      handleGameExited(event.data);
    }
  });
  
  // 监听游戏退出事件（直接从 Tauri）
  ipcRenderer.on('game-exited', (event, data) => {
    console.log('[Instances] Game exited:', data);
    handleGameExited(data);
  });
  
  // 定时轮询检查实例状态（每5秒）
  setInterval(async () => {
    await refreshRunningInstances();
  }, 5000);
}

// 监听来自父窗口的 i18n 重载消息
function initMessageListener() {
  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'reload-i18n') {
      console.log('[Instances] Received reload-i18n message');
      await loadI18n();
      renderDirTabs();
      renderVersions();
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

// i18n
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
  
  // 更新 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const value = getI18n(key);
    if (value) el.placeholder = value;
  });
}

function getI18n(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], i18nData);
}

// 刷新运行中的实例列表
async function refreshRunningInstances() {
  try {
    const newInstances = await ipcRenderer.invoke('get-running-instances') || [];
    const oldCount = runningInstances.length;
    const newCount = newInstances.length;
    
    // 检查是否有变化
    const oldPids = runningInstances.map(i => i.pid).sort().join(',');
    const newPids = newInstances.map(i => i.pid).sort().join(',');
    
    if (oldPids !== newPids) {
      console.log('[Instances] Running instances changed:', oldCount, '->', newCount);
      runningInstances = newInstances;
      updateRunningInstancesButton();
      renderVersions();
    }
  } catch (error) {
    console.error('Failed to refresh running instances:', error);
  }
}

function initEventListeners() {
  document.getElementById('refresh-btn')?.addEventListener('click', scanCurrentDir);
  
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    searchText = e.target.value.toLowerCase();
    renderVersions();
  });
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderVersions();
    });
  });
  
  // 布局切换按钮
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLayout = btn.dataset.layout;
      saveLayoutSetting();
      renderVersions();
    });
  });
  
  document.getElementById('add-folder-btn')?.addEventListener('click', addMinecraftDir);
  document.getElementById('empty-add-btn')?.addEventListener('click', addMinecraftDir);
  
  // 运行中实例按钮
  document.getElementById('running-instances-btn')?.addEventListener('click', showRunningInstancesModal);
  
  // 设置页面事件
  const backBtn = document.getElementById('back-to-list');
  const saveBtn = document.getElementById('save-settings');
  const resetBtn = document.getElementById('reset-settings');
  const refreshJavaBtn = document.getElementById('refresh-java');
  const browseJavaBtn = document.getElementById('browse-java');
  
  console.log('[Instances] Setting up event listeners...');
  console.log('[Instances] save-settings button:', saveBtn);
  
  backBtn?.addEventListener('click', closeSettings);
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      console.log('[Instances] Save button clicked!');
      saveVersionSettings();
    });
    console.log('[Instances] Save button event listener added');
  } else {
    console.error('[Instances] save-settings button not found!');
  }
  resetBtn?.addEventListener('click', resetSettings);
  refreshJavaBtn?.addEventListener('click', loadJavaList);
  browseJavaBtn?.addEventListener('click', browseJava);
  
  // Tab 切换
  initTabSwitching();
  
  // 图标选择器
  initIconPicker();
  
  // Mods 搜索
  document.getElementById('mods-search-input')?.addEventListener('input', (e) => {
    modsSearchText = e.target.value.toLowerCase();
    renderModsList(currentMods);
  });
  
  // Mods 操作按钮
  document.getElementById('mods-add-btn')?.addEventListener('click', addMod);
  document.getElementById('mods-folder-btn')?.addEventListener('click', openModsFolder);
  document.getElementById('mods-refresh-btn')?.addEventListener('click', () => loadModsList(editingVersionId));
  document.getElementById('mods-download-btn')?.addEventListener('click', openModsDownload);
  
  // 存档操作按钮
  document.getElementById('worlds-folder-btn')?.addEventListener('click', openWorldsFolder);
  document.getElementById('worlds-refresh-btn')?.addEventListener('click', () => loadWorldsList(editingVersionId));
  document.getElementById('worlds-search-input')?.addEventListener('input', (e) => {
    worldsSearchText = e.target.value.toLowerCase();
    renderWorldsList(currentWorlds);
  });
  
  // 资源包操作按钮
  document.getElementById('resourcepacks-add-btn')?.addEventListener('click', addResourcepack);
  document.getElementById('resourcepacks-folder-btn')?.addEventListener('click', openResourcepacksFolder);
  document.getElementById('resourcepacks-refresh-btn')?.addEventListener('click', () => loadResourcepacksList(editingVersionId));
  document.getElementById('resourcepacks-download-btn')?.addEventListener('click', openResourcepacksDownload);
  document.getElementById('resourcepacks-search-input')?.addEventListener('input', (e) => {
    resourcepacksSearchText = e.target.value.toLowerCase();
    renderResourcepacksList(currentResourcepacks);
  });
  
  // 内存自动分配开关
  document.getElementById('memory-auto')?.addEventListener('change', (e) => {
    const sliderSection = document.getElementById('memory-slider-section');
    if (sliderSection) {
      sliderSection.classList.toggle('disabled', e.target.checked);
    }
  });
  
  // 内存滑块同步
  initMemorySync();
  
  // 内存预设
  document.querySelectorAll('.memory-presets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const max = parseInt(btn.dataset.max);
      setMemoryValue(max);
    });
  });
  
  // 窗口预设
  document.querySelectorAll('.window-presets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('window-width').value = btn.dataset.w;
      document.getElementById('window-height').value = btn.dataset.h;
    });
  });
}

function initMemorySync() {
  const range = document.getElementById('memory-max');
  const input = document.getElementById('memory-max-input');
  if (!range || !input) return;
  
  range.addEventListener('input', () => {
    input.value = range.value;
  });
  
  input.addEventListener('input', () => {
    const val = Math.min(Math.max(parseInt(input.value) || 512, 512), 32768);
    range.value = val;
  });
  
  input.addEventListener('blur', () => {
    const val = Math.min(Math.max(parseInt(input.value) || 512, 512), 32768);
    input.value = val;
    range.value = val;
  });
  
  // 初始化所有数字输入框的箭头按钮
  initNumberInputArrows();
}

function initNumberInputArrows() {
  document.querySelectorAll('.input-with-arrows').forEach(wrapper => {
    const input = wrapper.querySelector('input[type="number"]');
    const upBtn = wrapper.querySelector('.arrow-btn[data-action="up"]');
    const downBtn = wrapper.querySelector('.arrow-btn[data-action="down"]');
    
    if (!input) return;
    
    const step = parseInt(input.step) || (input.id === 'memory-max-input' ? 128 : 10);
    const min = parseInt(input.min) || 0;
    const max = parseInt(input.max) || 99999;
    
    upBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      const current = parseInt(input.value) || min;
      const newVal = Math.min(current + step, max);
      input.value = newVal;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    
    downBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      const current = parseInt(input.value) || min;
      const newVal = Math.max(current - step, min);
      input.value = newVal;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

function setMemoryValue(max) {
  const maxRange = document.getElementById('memory-max');
  const maxInput = document.getElementById('memory-max-input');
  
  if (maxRange) maxRange.value = max;
  if (maxInput) maxInput.value = max;
}

async function loadSettings() {
  try {
    const settings = await ipcRenderer.invoke('get-launcher-settings') || {};
    console.log('[Instances] Loaded raw settings:', JSON.stringify(settings, null, 2));
    // 处理 snake_case 和 camelCase
    minecraftDirs = settings.minecraft_dirs || settings.minecraftDirs || [];
    versionSettings = settings.version_settings || settings.versionSettings || {};
    console.log('[Instances] Loaded versionSettings:', versionSettings);
    
    const mcDir = settings.minecraft_dir || settings.minecraftDir;
    if (minecraftDirs.length === 0 && mcDir) {
      minecraftDirs = [mcDir];
    }
    
    currentDirIndex = Math.min(currentDirIndex, Math.max(0, minecraftDirs.length - 1));
    console.log('[Instances] Loaded settings, minecraftDirs:', minecraftDirs);
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

async function loadLayoutSetting() {
  try {
    currentLayout = await ipcRenderer.invoke('get-instances-layout') || 'auto';
    // 更新布局按钮状态
    document.querySelectorAll('.layout-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === currentLayout);
    });
  } catch (error) {
    console.error('Failed to load layout setting:', error);
  }
}

async function saveLayoutSetting() {
  try {
    await ipcRenderer.invoke('set-instances-layout', currentLayout);
  } catch (error) {
    console.error('Failed to save layout setting:', error);
  }
}

async function loadRunningInstances() {
  try {
    runningInstances = await ipcRenderer.invoke('get-running-instances') || [];
    updateRunningInstancesButton();
  } catch (error) {
    console.error('Failed to load running instances:', error);
  }
}

function updateRunningInstancesButton() {
  const btn = document.getElementById('running-instances-btn');
  const badge = btn?.querySelector('.running-badge');
  const count = runningInstances.length;
  
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
  
  if (btn) {
    btn.classList.toggle('has-running', count > 0);
  }
}

function isVersionRunning(versionId) {
  return runningInstances.some(i => i.versionId === versionId);
}

async function saveSettings() {
  try {
    const payload = {
      minecraftDirs,
      versionSettings,
      minecraftDir: minecraftDirs[currentDirIndex] || null
    };
    console.log('[Instances] Saving settings:', JSON.stringify(payload, null, 2));
    await ipcRenderer.invoke('save-launcher-settings', payload);
    console.log('[Instances] Settings saved successfully');
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

function renderDirTabs() {
  const tabsContainer = document.getElementById('dir-tabs');
  if (!tabsContainer) return;
  
  if (minecraftDirs.length === 0) {
    const emptyTabText = getI18n('instances.emptyTab') || '点击添加目录';
    tabsContainer.innerHTML = `
      <div class="dir-tab empty" id="empty-tab">
        <i class="ri-folder-add-line"></i>
        <span>${emptyTabText}</span>
      </div>
    `;
    document.getElementById('empty-tab')?.addEventListener('click', addMinecraftDir);
    return;
  }
  
  const addDirTitle = getI18n('instances.toolbar.addDir') || '添加目录';
  const removeTitle = getI18n('common.remove') || '移除';
  tabsContainer.innerHTML = minecraftDirs.map((dir, index) => `
    <div class="dir-tab ${index === currentDirIndex ? 'active' : ''}" data-index="${index}">
      <i class="ri-folder-3-line"></i>
      <span title="${dir}">${path.basename(dir)}</span>
      <button class="tab-close" data-index="${index}" title="${removeTitle}"><i class="ri-close-line"></i></button>
    </div>
  `).join('') + `
    <button class="dir-tab-add" id="tab-add-btn" title="${addDirTitle}">
      <i class="ri-add-line"></i>
    </button>
  `;
  
  tabsContainer.querySelectorAll('.dir-tab[data-index]').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      const index = parseInt(tab.dataset.index);
      if (index !== currentDirIndex) {
        currentDirIndex = index;
        renderDirTabs();
        scanCurrentDir();
      }
    });
  });
  
  tabsContainer.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeMinecraftDir(parseInt(btn.dataset.index));
    });
  });
  
  document.getElementById('tab-add-btn')?.addEventListener('click', addMinecraftDir);
}

async function addMinecraftDir() {
  try {
    const result = await ipcRenderer.invoke('select-minecraft-dir');
    if (result.success && result.path) {
      if (minecraftDirs.includes(result.path)) {
        showToast(getI18n('instances.dirAlreadyAdded') || '该目录已添加', 'error');
        return;
      }
      minecraftDirs.push(result.path);
      currentDirIndex = minecraftDirs.length - 1;
      await saveSettings();
      renderDirTabs();
      await scanCurrentDir();
      showToast(getI18n('instances.dirAdded') || '目录已添加', 'success');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  } catch (error) {
    console.error('Add dir error:', error);
  }
}

async function removeMinecraftDir(index) {
  minecraftDirs.splice(index, 1);
  if (currentDirIndex >= minecraftDirs.length) {
    currentDirIndex = Math.max(0, minecraftDirs.length - 1);
  }
  await saveSettings();
  renderDirTabs();
  if (minecraftDirs.length > 0) {
    await scanCurrentDir();
  } else {
    versions = [];
    renderVersions();
  }
}

async function scanCurrentDir() {
  const grid = document.getElementById('versions-grid');
  if (!grid) return;
  
  if (minecraftDirs.length === 0 || !minecraftDirs[currentDirIndex]) {
    const emptyTitle = getI18n('instances.emptyState.title') || '添加 .minecraft 目录';
    const emptyDesc = getI18n('instances.emptyState.desc') || '点击上方"添加目录"按钮选择游戏目录';
    const selectDir = getI18n('instances.emptyState.selectDir') || '选择目录';
    grid.innerHTML = `
      <div class="empty-state">
        <i class="ri-folder-add-line"></i>
        <h3>${emptyTitle}</h3>
        <p>${emptyDesc}</p>
        <button class="btn-outline" id="empty-add-btn-inner"><i class="ri-folder-open-line"></i> ${selectDir}</button>
      </div>
    `;
    document.getElementById('empty-add-btn-inner')?.addEventListener('click', addMinecraftDir);
    return;
  }
  
  const scanningText = getI18n('instances.scanning') || '扫描版本中...';
  grid.innerHTML = `<div class="loading-state"><i class="ri-loader-4-line spin"></i><span>${scanningText}</span></div>`;
  
  try {
    const currentDir = minecraftDirs[currentDirIndex];
    console.log('Scanning dir:', currentDir);
    await ipcRenderer.invoke('set-minecraft-dir', currentDir);
    const result = await ipcRenderer.invoke('scan-versions');
    console.log('Scan result:', result);
    
    if (result.success) {
      versions = result.versions;
      console.log('Found versions:', versions.map(v => ({ id: v.id, hasJar: v.has_jar || v.hasJar })));
      renderVersions();
    } else {
      const scanFailed = getI18n('instances.scanFailed') || '扫描失败';
      const cannotRead = getI18n('instances.cannotReadVersions') || '无法读取版本信息';
      grid.innerHTML = `<div class="empty-state"><i class="ri-error-warning-line"></i><h3>${scanFailed}</h3><p>${result.error || cannotRead}</p></div>`;
    }
  } catch (error) {
    console.error('Scan error:', error);
    const scanError = getI18n('instances.scanError') || '扫描出错';
    grid.innerHTML = `<div class="empty-state"><i class="ri-error-warning-line"></i><h3>${scanError}</h3><p>${error.message}</p></div>`;
  }
}

function renderVersions() {
  const grid = document.getElementById('versions-grid');
  if (!grid) return;
  
  // 标准化版本数据（处理 snake_case 和 camelCase）
  const normalizedVersions = versions.map(v => ({
    ...v,
    hasJar: v.has_jar ?? v.hasJar ?? false,
    releaseTime: v.release_time || v.releaseTime,
    versionType: v.version_type || v.type,
    inheritsFrom: v.inherits_from || v.inheritsFrom,
    mainClass: v.main_class || v.mainClass,
  }));
  
  const filtered = normalizedVersions.filter(v => {
    if (searchText && !v.id.toLowerCase().includes(searchText)) return false;
    if (currentFilter === 'all') return true;
    if (currentFilter === 'release') return v.versionType === 'release';
    if (currentFilter === 'snapshot') return v.versionType === 'snapshot';
    if (currentFilter === 'modded') return v.loader !== 'vanilla';
    return true;
  });
  
  if (filtered.length === 0) {
    const noVersions = getI18n('instances.noVersionsFound') || '没有找到版本';
    const adjustFilter = getI18n('instances.adjustFilter') || '尝试调整筛选条件';
    const noInstalledVersions = getI18n('instances.noInstalledVersions') || '该目录下没有已安装的版本';
    grid.innerHTML = `<div class="empty-state"><i class="ri-inbox-line"></i><h3>${noVersions}</h3><p>${versions.length > 0 ? adjustFilter : noInstalledVersions}</p></div>`;
    grid.className = 'versions-grid';
    return;
  }
  
  // 确定布局模式
  let layoutMode = currentLayout;
  if (layoutMode === 'auto') {
    // 自动选择：少于6个用list，6-12个用grid，超过12个用compact
    if (filtered.length <= 5) {
      layoutMode = 'list';
    } else if (filtered.length <= 12) {
      layoutMode = 'grid';
    } else {
      layoutMode = 'grid'; // 默认grid
    }
  }
  
  // 设置布局类名
  grid.className = `versions-grid layout-${layoutMode}`;
  
  // 更新运行实例按钮
  updateRunningInstancesButton();
  
  // i18n 文本
  const runningText = getI18n('instances.running') || '运行中';
  const releaseText = getI18n('instances.toolbar.release') || '正式版';
  const snapshotText = getI18n('instances.toolbar.snapshot') || '快照';
  const customSettingsTitle = getI18n('instances.customSettings') || '已自定义设置';
  const missingJarTitle = getI18n('instances.missingJar') || '缺少 JAR';
  const versionSettingsTitle = getI18n('instances.settings.title') || '版本设置';
  const stopText = getI18n('common.stop') || '停止';
  const startText = getI18n('common.start') || '启动';
  const folderMenuTitle = getI18n('instances.folderMenu') || '快速打开';
  const loaderInstallTitle = getI18n('instances.loaderInstall') || '安装加载器';
  
  if (layoutMode === 'list') {
    // 列表布局（类似 HMCL）
    grid.innerHTML = filtered.map(v => {
      const settings = versionSettings[v.id] || {};
      const hasCustom = Object.keys(settings).length > 0;
      const isRunning = isVersionRunning(v.id);
      const displayName = v.id; // 直接使用版本ID作为显示名
      const iconType = settings.icon || v.loader;
      const customIcon = settings.customIcon;
      return `
        <div class="version-item ${isRunning ? 'running' : ''}" data-id="${v.id}">
          ${customIcon 
            ? `<div class="version-icon custom"><img src="${customIcon}" alt=""></div>`
            : `<div class="version-icon ${iconType}">${getLoaderIcon(iconType)}</div>`
          }
          <div class="version-info">
            <div class="version-name-row">
              <h4 class="version-name">${displayName}</h4>
              <div class="version-badges">
                ${isRunning ? `<span class="badge running"><i class="ri-play-circle-fill"></i> ${runningText}</span>` : ''}
                ${v.versionType === 'release' ? `<span class="badge release">${releaseText}</span>` : ''}
                ${v.versionType === 'snapshot' ? `<span class="badge snapshot">${snapshotText}</span>` : ''}
                ${v.loader !== 'vanilla' ? `<span class="badge ${v.loader}">${getLoaderName(v.loader)}</span>` : ''}
                ${hasCustom ? `<span class="badge custom" title="${customSettingsTitle}"><i class="ri-settings-3-line"></i></span>` : ''}
                ${!v.hasJar ? `<span class="badge warning" title="${missingJarTitle}"><i class="ri-alert-line"></i></span>` : ''}
              </div>
            </div>
            <span class="version-date">${formatDate(v.releaseTime)}</span>
          </div>
          <div class="version-actions">
            <div class="btn-menu-wrapper">
              <button class="btn-menu" data-id="${v.id}" title="${folderMenuTitle}"><i class="ri-menu-line"></i></button>
              <div class="folder-menu" data-id="${v.id}">
                <button class="folder-menu-item" data-action="game-dir" data-id="${v.id}"><i class="ri-folder-line"></i><span>游戏目录</span></button>
                <button class="folder-menu-item" data-action="version-dir" data-id="${v.id}"><i class="ri-folder-3-line"></i><span>版本文件夹</span></button>
                <button class="folder-menu-item" data-action="mods-dir" data-id="${v.id}"><i class="ri-puzzle-line"></i><span>Mods 文件夹</span></button>
                <button class="folder-menu-item" data-action="saves-dir" data-id="${v.id}"><i class="ri-earth-line"></i><span>存档文件夹</span></button>
                <button class="folder-menu-item" data-action="resourcepacks-dir" data-id="${v.id}"><i class="ri-palette-line"></i><span>资源包文件夹</span></button>
                <button class="folder-menu-item" data-action="logs-dir" data-id="${v.id}"><i class="ri-file-text-line"></i><span>日志文件夹</span></button>
                <div class="folder-menu-divider"></div>
                <button class="folder-menu-item" data-action="export-script" data-id="${v.id}"><i class="ri-terminal-box-line"></i><span>导出启动脚本</span></button>
              </div>
            </div>
            <button class="btn-settings" data-id="${v.id}" title="${versionSettingsTitle}"><i class="ri-settings-3-line"></i></button>
            <button class="btn-loader" data-id="${v.id}" title="${loaderInstallTitle}"><i class="ri-download-2-line"></i></button>
            <button class="btn-play ${isRunning ? 'is-running' : ''}" data-id="${v.id}" ${!v.hasJar ? 'disabled' : ''}>
              <i class="${isRunning ? 'ri-stop-fill' : 'ri-play-fill'}"></i> 
              ${isRunning ? stopText : startText}
            </button>
          </div>
        </div>
      `;
    }).join('');
  } else {
    // 网格布局（默认）
    grid.innerHTML = filtered.map(v => {
      const settings = versionSettings[v.id] || {};
      const hasCustom = Object.keys(settings).length > 0;
      const isRunning = isVersionRunning(v.id);
      const displayName = v.id; // 直接使用版本ID作为显示名
      const iconType = settings.icon || v.loader;
      const customIcon = settings.customIcon;
      return `
        <div class="version-card ${isRunning ? 'running' : ''}" data-id="${v.id}">
          <div class="version-header">
            ${customIcon 
              ? `<div class="version-icon custom"><img src="${customIcon}" alt=""></div>`
              : `<div class="version-icon ${iconType}">${getLoaderIcon(iconType)}</div>`
            }
            <div class="version-badges">
              ${isRunning ? '<span class="badge running"><i class="ri-play-circle-fill"></i></span>' : ''}
              ${v.versionType === 'release' ? `<span class="badge release">${releaseText}</span>` : ''}
              ${v.versionType === 'snapshot' ? `<span class="badge snapshot">${snapshotText}</span>` : ''}
              ${v.loader !== 'vanilla' ? `<span class="badge ${v.loader}">${getLoaderName(v.loader)}</span>` : ''}
              ${hasCustom ? `<span class="badge custom" title="${customSettingsTitle}"><i class="ri-settings-3-line"></i></span>` : ''}
              ${!v.hasJar ? `<span class="badge warning" title="${missingJarTitle}"><i class="ri-alert-line"></i></span>` : ''}
            </div>
          </div>
          <div class="version-body">
            <h4 class="version-name">${displayName}</h4>
            <span class="version-date">${formatDate(v.releaseTime)}</span>
          </div>
          <div class="version-actions">
            <div class="btn-menu-wrapper">
              <button class="btn-menu" data-id="${v.id}" title="${folderMenuTitle}"><i class="ri-menu-line"></i></button>
              <div class="folder-menu" data-id="${v.id}">
                <button class="folder-menu-item" data-action="game-dir" data-id="${v.id}"><i class="ri-folder-line"></i><span>游戏目录</span></button>
                <button class="folder-menu-item" data-action="version-dir" data-id="${v.id}"><i class="ri-folder-3-line"></i><span>版本文件夹</span></button>
                <button class="folder-menu-item" data-action="mods-dir" data-id="${v.id}"><i class="ri-puzzle-line"></i><span>Mods 文件夹</span></button>
                <button class="folder-menu-item" data-action="saves-dir" data-id="${v.id}"><i class="ri-earth-line"></i><span>存档文件夹</span></button>
                <button class="folder-menu-item" data-action="resourcepacks-dir" data-id="${v.id}"><i class="ri-palette-line"></i><span>资源包文件夹</span></button>
                <button class="folder-menu-item" data-action="logs-dir" data-id="${v.id}"><i class="ri-file-text-line"></i><span>日志文件夹</span></button>
                <div class="folder-menu-divider"></div>
                <button class="folder-menu-item" data-action="export-script" data-id="${v.id}"><i class="ri-terminal-box-line"></i><span>导出启动脚本</span></button>
              </div>
            </div>
            <button class="btn-settings" data-id="${v.id}" title="${versionSettingsTitle}"><i class="ri-settings-3-line"></i></button>
            <button class="btn-loader" data-id="${v.id}" title="${loaderInstallTitle}"><i class="ri-download-2-line"></i></button>
            <button class="btn-play ${isRunning ? 'is-running' : ''}" data-id="${v.id}" ${!v.hasJar ? 'disabled' : ''}>
              <i class="${isRunning ? 'ri-stop-fill' : 'ri-play-fill'}"></i> 
              ${isRunning ? stopText : startText}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
  
  grid.querySelectorAll('.btn-play').forEach(btn => {
    btn.addEventListener('click', (e) => { 
      e.stopPropagation(); 
      const versionId = btn.dataset.id;
      if (btn.classList.contains('is-running')) {
        stopVersion(versionId);
      } else {
        launchVersion(versionId); 
      }
    });
  });
  
  grid.querySelectorAll('.btn-settings').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSettings(btn.dataset.id); });
  });
  
  // 加载器安装按钮
  grid.querySelectorAll('.btn-loader').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); showLoaderInstallModal(btn.dataset.id); });
  });
  
  // 文件夹菜单按钮 - 使用事件委托确保网格布局也能正常工作
  grid.querySelectorAll('.btn-menu').forEach(btn => {
    btn.addEventListener('click', (e) => { 
      e.stopPropagation();
      e.preventDefault();
      // 找到当前按钮对应的菜单（在同一个 wrapper 内）
      const wrapper = btn.closest('.btn-menu-wrapper');
      const menu = wrapper?.querySelector('.folder-menu');
      if (menu) {
        toggleFolderMenuElement(btn, menu);
      }
    });
  });
  
  // 文件夹菜单项
  grid.querySelectorAll('.folder-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      handleFolderMenuAction(item.dataset.action, item.dataset.id);
      closeFolderMenus();
    });
  });
  
  // 点击其他地方关闭菜单
  document.addEventListener('click', closeFolderMenus);
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

function getLoaderName(loader) {
  const names = { forge: 'Forge', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', optifine: 'OptiFine' };
  return names[loader] || loader;
}

function detectGameVersion(versionId) {
  // 从版本ID中提取游戏版本号
  // 例如: "1.8.9-Forge-OptiFine我爱你" -> "1.8.9"
  const match = versionId.match(/^(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function formatDate(dateStr) {
  if (!dateStr) return '未知';
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '未知'; }
}

async function stopVersion(versionId) {
  const instance = runningInstances.find(i => i.versionId === versionId);
  if (instance) {
    try {
      const result = await ipcRenderer.invoke('kill-instance', instance.pid);
      if (result.success) {
        // 立即从本地列表中移除
        runningInstances = runningInstances.filter(i => i.pid !== instance.pid);
        updateRunningInstancesButton();
        renderVersions();
        showToast(`${versionId} 已停止`, 'success');
      } else {
        showToast('停止失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (error) {
      showToast('停止失败: ' + error.message, 'error');
    }
  }
}

async function launchVersion(versionId) {
  const btn = document.querySelector(`.btn-play[data-id="${versionId}"]`);
  
  // 检查是否已在运行
  const isRunning = isVersionRunning(versionId);
  if (isRunning) {
    // 显示确认对话框
    const confirmed = await showDuplicateInstanceDialog(versionId);
    if (!confirmed) return;
  }
  
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i>';
  }
  
  // 显示启动弹窗
  showLaunchModal();
  
  try {
    const settings = versionSettings[versionId] || {};
    
    // 检查是否启用自动补全（默认启用）
    const autoComplete = settings.autoCompleteFiles !== false;
    
    if (autoComplete) {
      // 先补全游戏文件
      updateLaunchStep('complete-files', 'active', '检查游戏文件...');
      updateLaunchStatus('正在检查并补全游戏文件...');
      
      try {
        const completeResult = await ipcRenderer.invoke('complete-game-files', versionId);
        if (completeResult.success) {
          if (completeResult.skipped) {
            updateLaunchStep('complete-files', 'done', '已跳过');
          } else if (completeResult.downloadedFiles > 0) {
            updateLaunchStep('complete-files', 'done', `已补全 ${completeResult.downloadedFiles} 个文件`);
          } else {
            updateLaunchStep('complete-files', 'done', '文件完整');
          }
        } else {
          updateLaunchStep('complete-files', 'error', '补全失败');
          console.warn('[Launch] File completion failed:', completeResult);
        }
      } catch (completeError) {
        console.warn('[Launch] File completion error:', completeError);
        updateLaunchStep('complete-files', 'error', '补全出错');
      }
    }
    
    const result = await ipcRenderer.invoke('launch-game', { 
      versionId, 
      customSettings: settings,
      forceNewInstance: isRunning // 如果已确认，强制启动新实例
    });
    
    if (result.success) {
      // 标记所有步骤为完成
      markAllStepsDone();
      updateLaunchStatus('游戏已启动！');
      await delay(1500);
      hideLaunchModal();
      showToast(`${versionId} 已启动`, 'success');
      
      // 刷新运行实例列表
      await loadRunningInstances();
      renderVersions();
      
      // 执行启动器行为（使用后端返回的设置）
      const launcherBehavior = result.launcherBehavior || 'keep-front';
      if (launcherBehavior !== 'keep-front') {
        // 延迟 500ms 执行，确保弹窗完全关闭
        setTimeout(async () => {
          await ipcRenderer.invoke('execute-launcher-behavior', launcherBehavior);
        }, 500);
      }
    } else if (result.error === 'duplicate_instance') {
      // 重复实例，显示确认对话框
      hideLaunchModal();
      const confirmed = await showDuplicateInstanceDialog(versionId);
      if (confirmed) {
        // 用户确认，强制启动新实例
        launchVersionForced(versionId);
      }
    } else {
      updateLaunchStatus('启动失败: ' + result.error);
    }
  } catch (error) {
    updateLaunchStatus('启动出错: ' + error.message);
    showToast('启动出错: ' + error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      const stillRunning = isVersionRunning(versionId);
      btn.innerHTML = stillRunning 
        ? '<i class="ri-stop-fill"></i> 停止' 
        : '<i class="ri-play-fill"></i> 启动';
      btn.classList.toggle('is-running', stillRunning);
    }
  }
}

async function launchVersionForced(versionId) {
  const btn = document.querySelector(`.btn-play[data-id="${versionId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i>';
  }
  
  showLaunchModal();
  
  try {
    const settings = versionSettings[versionId] || {};
    
    // 检查是否启用自动补全（默认启用）
    const autoComplete = settings.autoCompleteFiles !== false;
    
    if (autoComplete) {
      updateLaunchStep('complete-files', 'active', '检查游戏文件...');
      updateLaunchStatus('正在检查并补全游戏文件...');
      
      try {
        const completeResult = await ipcRenderer.invoke('complete-game-files', versionId);
        if (completeResult.success) {
          if (completeResult.skipped) {
            updateLaunchStep('complete-files', 'done', '已跳过');
          } else if (completeResult.downloadedFiles > 0) {
            updateLaunchStep('complete-files', 'done', `已补全 ${completeResult.downloadedFiles} 个文件`);
          } else {
            updateLaunchStep('complete-files', 'done', '文件完整');
          }
        }
      } catch (completeError) {
        console.warn('[Launch] File completion error:', completeError);
        updateLaunchStep('complete-files', 'error', '补全出错');
      }
    }
    
    const result = await ipcRenderer.invoke('launch-game', { 
      versionId, 
      customSettings: settings,
      forceNewInstance: true
    });
    
    if (result.success) {
      markAllStepsDone();
      updateLaunchStatus('游戏已启动！');
      await delay(1500);
      hideLaunchModal();
      showToast(`${versionId} 已启动`, 'success');
      await loadRunningInstances();
      renderVersions();
      
      // 执行启动器行为（使用后端返回的设置）
      const launcherBehavior = result.launcherBehavior || 'keep-front';
      if (launcherBehavior !== 'keep-front') {
        setTimeout(async () => {
          await ipcRenderer.invoke('execute-launcher-behavior', launcherBehavior);
        }, 500);
      }
    } else {
      updateLaunchStatus('启动失败: ' + result.error);
    }
  } catch (error) {
    updateLaunchStatus('启动出错: ' + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      const stillRunning = isVersionRunning(versionId);
      btn.innerHTML = stillRunning 
        ? '<i class="ri-stop-fill"></i> 停止' 
        : '<i class="ri-play-fill"></i> 启动';
    }
  }
}

function showDuplicateInstanceDialog(versionId) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog-header">
          <i class="ri-error-warning-line dialog-icon warning"></i>
          <h3>实例已在运行</h3>
        </div>
        <div class="dialog-body">
          <p><strong>${versionId}</strong> 已经有一个实例在运行中。</p>
          <p>是否要启动另一个实例？</p>
        </div>
        <div class="dialog-footer">
          <button class="btn-secondary" data-action="cancel">取消</button>
          <button class="btn-primary" data-action="confirm">启动新实例</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    
    const closeDialog = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    
    overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => closeDialog(false));
    overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', () => closeDialog(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog(false);
    });
  });
}

// 运行中实例管理弹窗
async function showRunningInstancesModal() {
  await loadRunningInstances();
  
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay running-instances-modal';
  overlay.innerHTML = `
    <div class="dialog large">
      <div class="dialog-header">
        <h3><i class="ri-play-circle-line"></i> 运行中的实例</h3>
        <button class="dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="dialog-body">
        ${runningInstances.length === 0 
          ? '<div class="empty-state small"><i class="ri-inbox-line"></i><p>没有运行中的实例</p></div>'
          : `<div class="running-instances-list">
              ${runningInstances.map(instance => `
                <div class="running-instance-item" data-pid="${instance.pid}">
                  <div class="instance-info">
                    <div class="instance-name">${instance.versionId}</div>
                    <div class="instance-meta">
                      <span><i class="ri-user-line"></i> ${instance.account?.username || '未知'}</span>
                      <span><i class="ri-time-line"></i> ${formatRunningTime(instance.startTime)}</span>
                      <span class="instance-pid">PID: ${instance.pid}</span>
                    </div>
                  </div>
                  <div class="instance-actions">
                    <button class="btn-icon-sm" data-action="logs" data-pid="${instance.pid}" title="查看日志">
                      <i class="ri-file-text-line"></i>
                    </button>
                    <button class="btn-icon-sm danger" data-action="kill" data-pid="${instance.pid}" title="强制终止">
                      <i class="ri-stop-circle-line"></i>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>`
        }
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  
  const closeDialog = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };
  
  overlay.querySelector('.dialog-close')?.addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  
  // 查看日志
  overlay.querySelectorAll('[data-action="logs"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = parseInt(btn.dataset.pid);
      await showInstanceLogs(pid);
    });
  });
  
  // 强制终止
  overlay.querySelectorAll('[data-action="kill"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = parseInt(btn.dataset.pid);
      const result = await ipcRenderer.invoke('kill-instance', pid);
      if (result.success) {
        showToast('实例已终止', 'success');
        closeDialog();
        await loadRunningInstances();
        renderVersions();
      } else {
        showToast('终止失败: ' + result.error, 'error');
      }
    });
  });
}

async function showInstanceLogs(pid) {
  const result = await ipcRenderer.invoke('get-instance-logs', pid);
  const instance = runningInstances.find(i => i.pid === pid);
  
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay logs-modal';
  overlay.innerHTML = `
    <div class="dialog large">
      <div class="dialog-header">
        <h3><i class="ri-file-text-line"></i> ${instance?.versionId || 'Unknown'} 日志</h3>
        <button class="dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="dialog-body">
        <div class="logs-container">
          ${result.success && result.logs.length > 0
            ? result.logs.map(log => `
                <div class="log-line ${log.type}">
                  <span class="log-time">${new Date(log.time).toLocaleTimeString()}</span>
                  <span class="log-content">${escapeHtml(log.message)}</span>
                </div>
              `).join('')
            : '<div class="empty-state small"><i class="ri-file-text-line"></i><p>暂无日志</p></div>'
          }
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" data-action="close">关闭</button>
        <button class="btn-primary" data-action="copy">复制日志</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  
  const closeDialog = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };
  
  overlay.querySelector('.dialog-close')?.addEventListener('click', closeDialog);
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  
  overlay.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
    if (result.success && result.logs.length > 0) {
      const text = result.logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.message}`).join('\n');
      navigator.clipboard.writeText(text);
      showToast('日志已复制', 'success');
    }
  });
  
  // 滚动到底部
  const logsContainer = overlay.querySelector('.logs-container');
  if (logsContainer) {
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
}

function formatRunningTime(startTime) {
  const diff = Date.now() - startTime;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  }
  return `${minutes}分钟`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 处理游戏退出事件
function handleGameExited(data) {
  console.log('[Instances] handleGameExited:', data);
  
  // 更新运行实例列表
  runningInstances = runningInstances.filter(i => i.pid !== data.pid);
  updateRunningInstancesButton();
  renderVersions();
  
  // 崩溃弹窗由主窗口处理，这里只显示正常退出的提示
  if (!data.crashed && data.exitCode === 0) {
    showToast(`${data.versionId} 已退出`, 'success');
  }
}

// 显示崩溃报告弹窗
function showCrashReport(data) {
  const { versionId, exitCode, crashInfo, errorLogs } = data;
  
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay crash-report-modal';
  overlay.innerHTML = `
    <div class="dialog large crash-dialog">
      <div class="dialog-header crash-header">
        <div class="crash-icon">
          <i class="ri-error-warning-fill"></i>
        </div>
        <div class="crash-title">
          <h3>游戏崩溃</h3>
          <span class="crash-version">${escapeHtml(versionId)}</span>
        </div>
        <button class="dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="dialog-body crash-body">
        <div class="crash-reason-card">
          <div class="crash-reason-header">
            <i class="ri-bug-line"></i>
            <span>崩溃原因</span>
          </div>
          <div class="crash-reason-content">
            <h4>${escapeHtml(crashInfo.reason)}</h4>
            <p class="crash-details">${escapeHtml(crashInfo.details)}</p>
          </div>
        </div>
        
        <div class="crash-suggestions-card">
          <div class="crash-suggestions-header">
            <i class="ri-lightbulb-line"></i>
            <span>解决建议</span>
          </div>
          <ul class="crash-suggestions-list">
            ${crashInfo.suggestions.map(s => `<li><i class="ri-arrow-right-s-line"></i>${escapeHtml(s)}</li>`).join('')}
          </ul>
        </div>
        
        <div class="crash-logs-card">
          <div class="crash-logs-header" id="crash-logs-toggle">
            <i class="ri-terminal-box-line"></i>
            <span>错误日志</span>
            <i class="ri-arrow-down-s-line toggle-icon"></i>
          </div>
          <div class="crash-logs-content collapsed" id="crash-logs-content">
            <pre class="crash-logs-pre">${errorLogs && errorLogs.length > 0 
              ? errorLogs.map(l => escapeHtml(l)).join('\n') 
              : '无错误日志'}</pre>
          </div>
        </div>
        
        <div class="crash-info-bar">
          <span class="crash-exit-code">退出码: ${exitCode}</span>
          <span class="crash-time">${new Date().toLocaleString()}</span>
        </div>
      </div>
      <div class="dialog-footer crash-footer">
        <button class="btn-secondary" data-action="copy-logs">
          <i class="ri-file-copy-line"></i>
          复制日志
        </button>
        <button class="btn-secondary" data-action="open-logs-folder">
          <i class="ri-folder-open-line"></i>
          打开日志目录
        </button>
        <button class="btn-primary" data-action="close">
          <i class="ri-close-line"></i>
          关闭
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
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  
  // 展开/折叠日志
  overlay.querySelector('#crash-logs-toggle')?.addEventListener('click', () => {
    const content = overlay.querySelector('#crash-logs-content');
    const icon = overlay.querySelector('.toggle-icon');
    if (content) {
      content.classList.toggle('collapsed');
      icon?.classList.toggle('rotated');
    }
  });
  
  // 复制日志
  overlay.querySelector('[data-action="copy-logs"]')?.addEventListener('click', () => {
    const logText = [
      `=== 崩溃报告 ===`,
      `版本: ${versionId}`,
      `时间: ${new Date().toLocaleString()}`,
      `退出码: ${exitCode}`,
      ``,
      `=== 崩溃原因 ===`,
      crashInfo.reason,
      crashInfo.details,
      ``,
      `=== 解决建议 ===`,
      ...crashInfo.suggestions.map(s => `- ${s}`),
      ``,
      `=== 错误日志 ===`,
      ...(errorLogs || [])
    ].join('\n');
    
    navigator.clipboard.writeText(logText);
    showToast('崩溃报告已复制', 'success');
  });
  
  // 打开日志目录
  overlay.querySelector('[data-action="open-logs-folder"]')?.addEventListener('click', async () => {
    try {
      const mcDir = minecraftDirs[currentDirIndex];
      if (mcDir) {
        const logsPath = `${mcDir}/logs`;
        await shell.openExternal(`file://${logsPath}`);
      }
    } catch (error) {
      console.error('Open logs folder error:', error);
      showToast('无法打开日志目录', 'error');
    }
  });
}

// 监听启动步骤事件
ipcRenderer.on('launch-step', (event, data) => {
  const { step, status, message } = data;
  updateLaunchStep(step, status, message);
  
  if (status === 'active') {
    updateLaunchStatus(message || '处理中...');
  } else if (status === 'error') {
    updateLaunchStatus('错误: ' + message);
  }
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showLaunchModal() {
  const modal = document.getElementById('launch-modal');
  if (modal) {
    modal.classList.add('show');
    // 重置所有步骤
    document.querySelectorAll('.launch-step').forEach(step => {
      step.classList.remove('active', 'done', 'error');
      const icon = step.querySelector('.step-icon i');
      if (icon) {
        icon.className = 'ri-loader-4-line';
      }
      const detail = step.querySelector('.step-detail');
      if (detail) detail.textContent = '';
    });
    updateLaunchStatus('正在准备...');
  }
  
  // 绑定关闭和取消按钮
  document.getElementById('launch-modal-close')?.addEventListener('click', hideLaunchModal);
  document.getElementById('launch-cancel')?.addEventListener('click', hideLaunchModal);
}

function hideLaunchModal() {
  document.getElementById('launch-modal')?.classList.remove('show');
}

function updateLaunchStep(stepName, status, message = '') {
  const step = document.querySelector(`.launch-step[data-step="${stepName}"]`);
  if (step) {
    step.classList.remove('active', 'done', 'error');
    if (status) step.classList.add(status);
    
    // 更新图标
    const icon = step.querySelector('.step-icon i');
    if (icon) {
      if (status === 'done') {
        icon.className = 'ri-check-line';
      } else if (status === 'error') {
        icon.className = 'ri-close-line';
      } else if (status === 'active') {
        icon.className = 'ri-loader-4-line';
      }
    }
    
    // 更新打勾图标
    const checkIcon = step.querySelector('.step-check i');
    if (checkIcon) {
      if (status === 'error') {
        checkIcon.className = 'ri-close-line';
      } else {
        checkIcon.className = 'ri-check-line';
      }
    }
    
    // 更新详情文字
    const detail = step.querySelector('.step-detail');
    if (detail && message) {
      detail.textContent = message;
    }
  }
}

// 标记所有步骤为完成（修复关闭弹窗时步骤未打勾的问题）
function markAllStepsDone() {
  const steps = ['complete-files', 'check-account', 'check-java', 'check-dir', 'build-classpath', 'extract-natives', 'build-args', 'launch'];
  steps.forEach(stepName => {
    const step = document.querySelector(`.launch-step[data-step="${stepName}"]`);
    if (step && !step.classList.contains('error')) {
      step.classList.remove('active');
      step.classList.add('done');
      const icon = step.querySelector('.step-icon i');
      if (icon) {
        icon.className = 'ri-check-line';
      }
    }
  });
}

function updateLaunchStatus(text) {
  const status = document.getElementById('launch-status');
  if (status) status.textContent = text;
}

// ═══════════════════════════════════════════════════════════
// 版本设置页面
// ═══════════════════════════════════════════════════════════

async function openSettings(versionId) {
  editingVersionId = versionId;
  
  const overlay = document.getElementById('settings-overlay');
  const title = document.getElementById('settings-title');
  if (title) title.textContent = `${versionId} 设置`;
  
  // 设置版本名称输入框（可编辑，用于重命名）
  const nameInput = document.getElementById('version-name-input');
  const idDisplay = document.getElementById('version-id-display');
  const settings = versionSettings[versionId] || {};
  
  if (nameInput) {
    nameInput.value = versionId; // 显示当前版本ID，用户可以修改来重命名
  }
  if (idDisplay) {
    // 显示实际的游戏版本（从 inheritsFrom 或检测）
    const version = versions.find(v => v.id === versionId);
    const gameVersion = version?.inheritsFrom || detectGameVersion(versionId);
    idDisplay.textContent = gameVersion ? `游戏版本: ${gameVersion}` : '';
  }
  
  // 设置图标
  updateVersionIcon(settings.icon || 'grass', settings.customIcon || null);
  selectedIcon = settings.icon || 'grass';
  customIconPath = settings.customIcon || null;
  
  // 重置 tab 到常规
  switchTab('general');
  
  // 加载系统内存信息
  loadSystemMemory();
  
  // 加载 Java 列表
  await loadJavaList();
  
  // Java
  const javaSelect = document.getElementById('java-select');
  if (javaSelect && settings.javaPath) {
    let found = false;
    for (const opt of javaSelect.options) {
      if (opt.value === settings.javaPath) {
        found = true;
        break;
      }
    }
    if (!found && settings.javaPath) {
      const opt = document.createElement('option');
      opt.value = settings.javaPath;
      opt.textContent = `自定义: ${path.basename(settings.javaPath)}`;
      javaSelect.appendChild(opt);
    }
    javaSelect.value = settings.javaPath;
  } else if (javaSelect) {
    javaSelect.value = '';
  }
  
  // 内存自动分配
  const memoryAuto = document.getElementById('memory-auto');
  const sliderSection = document.getElementById('memory-slider-section');
  if (memoryAuto) {
    memoryAuto.checked = settings.memoryAuto || false;
    if (sliderSection) {
      sliderSection.classList.toggle('disabled', settings.memoryAuto || false);
    }
  }
  
  // 内存值
  const memMax = settings.memoryMax || 2048;
  setMemoryValue(memMax);
  
  // 版本隔离
  const isolationCheck = document.getElementById('version-isolation');
  if (isolationCheck) {
    isolationCheck.checked = settings.versionIsolation || false;
  }
  
  // 自动补全文件（默认为 true）
  const autoCompleteCheck = document.getElementById('auto-complete-files');
  if (autoCompleteCheck) {
    autoCompleteCheck.checked = settings.autoCompleteFiles !== false;
  }
  
  // 窗口
  document.getElementById('window-width').value = settings.windowWidth || '';
  document.getElementById('window-height').value = settings.windowHeight || '';
  
  // JVM 参数
  document.getElementById('jvm-args').value = (settings.jvmArgs || []).join('\n');
  
  // 启动器行为
  const behaviorSelect = document.getElementById('version-launcher-behavior');
  if (behaviorSelect) {
    behaviorSelect.value = settings.launcherBehavior || '';
    updateVersionBehaviorHint(settings.launcherBehavior || '');
    
    // 绑定变化事件
    behaviorSelect.onchange = (e) => {
      updateVersionBehaviorHint(e.target.value);
    };
  }
  
  // 显示设置页面
  overlay?.classList.add('show');
  
  // 通知父窗口隐藏侧边栏
  notifyParent('hide-sidebar');
}

function updateVersionBehaviorHint(behavior) {
  const hintBlock = document.getElementById('version-behavior-hint');
  if (!hintBlock) return;
  
  const hints = {
    '': '使用全局设置：跟随设置页面中的全局配置',
    'keep-front': '保持前台：启动器保持显示，不做任何操作',
    'auto-hide': '自动隐藏：游戏启动后启动器自动隐藏，需手动打开',
    'hide-when-game-front': '游戏在前台时隐藏：游戏运行时隐藏，游戏关闭后自动显示',
    'auto-exit': '自动退出：游戏启动后启动器自动退出'
  };
  
  const span = hintBlock.querySelector('span');
  if (span) {
    span.textContent = hints[behavior] || hints[''];
  }
}

async function loadSystemMemory() {
  try {
    const result = await ipcRenderer.invoke('get-system-memory');
    if (result) {
      const usedEl = document.querySelector('.system-memory-info .memory-used');
      const totalEl = document.querySelector('.system-memory-info .memory-total');
      if (usedEl) usedEl.textContent = (result.used / 1024).toFixed(1);
      if (totalEl) totalEl.textContent = (result.total / 1024).toFixed(1);
      
      // 更新滑块最大值
      const maxRange = document.getElementById('memory-max');
      if (maxRange) {
        maxRange.max = Math.min(result.total, 32768);
      }
    }
  } catch (error) {
    console.error('Load system memory error:', error);
  }
}

function closeSettings() {
  document.getElementById('settings-overlay')?.classList.remove('show');
  editingVersionId = null;
  
  // 通知父窗口显示侧边栏
  notifyParent('show-sidebar');
}

async function loadJavaList() {
  const select = document.getElementById('java-select');
  if (!select) return;
  
  const currentValue = select.value;
  select.innerHTML = '<option value="">使用全局设置</option><option value="" disabled>正在扫描...</option>';
  
  try {
    const result = await ipcRenderer.invoke('detect-java');
    
    select.innerHTML = '<option value="">使用全局设置</option>';
    
    if (result.success && result.javaList.length > 0) {
      javaList = result.javaList;
      
      for (const java of javaList) {
        const opt = document.createElement('option');
        opt.value = java.path;
        opt.textContent = `${java.name} (Java ${java.version})`;
        select.appendChild(opt);
      }
    }
    
    if (currentValue) {
      let found = false;
      for (const opt of select.options) {
        if (opt.value === currentValue) {
          found = true;
          break;
        }
      }
      if (!found && currentValue) {
        const opt = document.createElement('option');
        opt.value = currentValue;
        opt.textContent = `自定义: ${path.basename(currentValue)}`;
        select.appendChild(opt);
      }
      select.value = currentValue;
    }
  } catch (error) {
    console.error('Load java list error:', error);
    select.innerHTML = '<option value="">使用全局设置</option>';
  }
}

async function browseJava() {
  try {
    const result = await ipcRenderer.invoke('select-java-path');
    if (result.success) {
      const select = document.getElementById('java-select');
      if (select) {
        const opt = document.createElement('option');
        opt.value = result.path;
        opt.textContent = `自定义: Java ${result.version}`;
        select.appendChild(opt);
        select.value = result.path;
      }
      showToast(`已选择 Java ${result.version}`, 'success');
    }
  } catch (error) {
    console.error('Browse java error:', error);
  }
}

function resetSettings() {
  document.getElementById('java-select').value = '';
  document.getElementById('memory-auto').checked = false;
  document.getElementById('memory-slider-section')?.classList.remove('disabled');
  document.getElementById('memory-max').value = 2048;
  document.getElementById('memory-max-input').value = 2048;
  document.getElementById('version-isolation').checked = false;
  document.getElementById('auto-complete-files').checked = true; // 默认开启
  document.getElementById('window-width').value = '';
  document.getElementById('window-height').value = '';
  document.getElementById('jvm-args').value = '';
  
  const behaviorSelect = document.getElementById('version-launcher-behavior');
  if (behaviorSelect) {
    behaviorSelect.value = '';
    updateVersionBehaviorHint('');
  }
}

async function saveVersionSettings() {
  console.log('[Instances] ========== saveVersionSettings called ==========');
  if (!editingVersionId) {
    console.log('[Instances] No editingVersionId, returning');
    return;
  }
  
  const javaPath = document.getElementById('java-select')?.value || '';
  const memoryAuto = document.getElementById('memory-auto')?.checked || false;
  const memoryMaxInput = document.getElementById('memory-max-input')?.value;
  const versionIsolation = document.getElementById('version-isolation')?.checked || false;
  const autoCompleteFiles = document.getElementById('auto-complete-files')?.checked !== false; // 默认为 true
  const windowWidth = document.getElementById('window-width')?.value;
  const windowHeight = document.getElementById('window-height')?.value;
  const jvmArgsText = document.getElementById('jvm-args')?.value.trim();
  const launcherBehaviorEl = document.getElementById('version-launcher-behavior');
  const launcherBehavior = launcherBehaviorEl?.value || '';
  const newVersionName = document.getElementById('version-name-input')?.value.trim();
  const gameArgsText = document.getElementById('game-args')?.value.trim();
  const serverIp = document.getElementById('server-ip')?.value.trim();
  const envVarsText = document.getElementById('env-vars')?.value.trim();
  
  console.log('[Instances] Saving version settings for:', editingVersionId);
  
  // 检查是否需要重命名版本
  let actualVersionId = editingVersionId;
  if (newVersionName && newVersionName !== editingVersionId) {
    try {
      const result = await ipcRenderer.invoke('rename-version', editingVersionId, newVersionName);
      if (result.success) {
        // 重命名成功，更新版本ID
        actualVersionId = result.newId;
        // 迁移旧的版本设置到新ID
        if (versionSettings[editingVersionId]) {
          versionSettings[actualVersionId] = versionSettings[editingVersionId];
          delete versionSettings[editingVersionId];
        }
        showToast(`版本已重命名为 ${actualVersionId}`, 'success');
      } else {
        showToast(result.error || '重命名失败', 'error');
        return;
      }
    } catch (error) {
      console.error('Rename version error:', error);
      showToast('重命名失败: ' + error.message, 'error');
      return;
    }
  }
  
  const settings = {};
  if (javaPath) settings.javaPath = javaPath;
  if (memoryAuto) settings.memoryAuto = true;
  if (memoryMaxInput && !memoryAuto) {
    settings.memoryMax = parseInt(memoryMaxInput);
    settings.memoryMin = Math.min(512, parseInt(memoryMaxInput));
  }
  if (versionIsolation) settings.versionIsolation = true;
  // autoCompleteFiles 默认为 true，只有显式关闭时才保存
  if (!autoCompleteFiles) settings.autoCompleteFiles = false;
  if (windowWidth) settings.windowWidth = parseInt(windowWidth);
  if (windowHeight) settings.windowHeight = parseInt(windowHeight);
  if (jvmArgsText) settings.jvmArgs = jvmArgsText.split('\n').filter(s => s.trim());
  if (launcherBehavior) settings.launcherBehavior = launcherBehavior;
  // 不再需要 customName，因为我们直接重命名了版本
  if (selectedIcon && selectedIcon !== 'grass') settings.icon = selectedIcon;
  if (customIconPath) settings.customIcon = customIconPath;
  if (gameArgsText) settings.gameArgs = gameArgsText.split('\n').filter(s => s.trim());
  if (serverIp) settings.serverIp = serverIp;
  if (envVarsText) settings.envVars = envVarsText.split('\n').filter(s => s.trim());
  
  console.log('[Instances] Version settings to save:', JSON.stringify(settings, null, 2));
  
  if (Object.keys(settings).length > 0) {
    versionSettings[actualVersionId] = settings;
    console.log('[Instances] Added settings for version:', actualVersionId);
  } else {
    delete versionSettings[actualVersionId];
    console.log('[Instances] Removed settings for version (empty):', actualVersionId);
  }
  
  console.log('[Instances] All versionSettings before save:', JSON.stringify(versionSettings, null, 2));
  
  await saveSettings();
  closeSettings();
  await scanCurrentDir(); // 重新扫描以获取更新后的版本列表
  showToast('设置已保存', 'success');
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="${type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}"></i><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

function notifyParent(action, data = {}) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ action, ...data }, '*');
  }
}

// ═══════════════════════════════════════════════════════════
// Tab 切换
// ═══════════════════════════════════════════════════════════

function initTabSwitching() {
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // 更新 tab 按钮状态
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // 更新 tab 面板显示
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
  
  // 根据 tab 加载对应数据
  if (tabName === 'mods' && editingVersionId) {
    loadModsList(editingVersionId);
  } else if (tabName === 'worlds' && editingVersionId) {
    loadWorldsList(editingVersionId);
  } else if (tabName === 'resourcepacks' && editingVersionId) {
    loadResourcepacksList(editingVersionId);
  }
}

// ═══════════════════════════════════════════════════════════
// 图标选择器
// ═══════════════════════════════════════════════════════════

function initIconPicker() {
  const editBtn = document.getElementById('edit-icon-btn');
  const modal = document.getElementById('icon-picker-modal');
  const closeBtn = document.getElementById('icon-picker-close');
  const cancelBtn = document.getElementById('icon-picker-cancel');
  const confirmBtn = document.getElementById('icon-picker-confirm');
  const uploadBtn = document.getElementById('upload-icon-btn');
  
  editBtn?.addEventListener('click', openIconPicker);
  closeBtn?.addEventListener('click', closeIconPicker);
  cancelBtn?.addEventListener('click', closeIconPicker);
  confirmBtn?.addEventListener('click', confirmIconSelection);
  uploadBtn?.addEventListener('click', uploadCustomIcon);
  
  // 预设图标点击
  document.querySelectorAll('#preset-icons .icon-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('#preset-icons .icon-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      selectedIcon = option.dataset.icon;
      customIconPath = null;
    });
  });
}

function openIconPicker() {
  const modal = document.getElementById('icon-picker-modal');
  modal?.classList.add('show');
  
  // 重置选择状态
  const settings = versionSettings[editingVersionId] || {};
  selectedIcon = settings.icon || 'grass';
  customIconPath = settings.customIcon || null;
  
  // 更新选中状态
  document.querySelectorAll('#preset-icons .icon-option').forEach(option => {
    option.classList.toggle('selected', option.dataset.icon === selectedIcon && !customIconPath);
  });
}

function closeIconPicker() {
  document.getElementById('icon-picker-modal')?.classList.remove('show');
}

async function uploadCustomIcon() {
  try {
    const { open } = window.__TAURI__.dialog;
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg']
      }]
    });
    
    if (selected) {
      customIconPath = selected;
      selectedIcon = 'custom';
      
      // 取消预设图标选中
      document.querySelectorAll('#preset-icons .icon-option').forEach(o => o.classList.remove('selected'));
      
      showToast('已选择自定义图标', 'success');
    }
  } catch (error) {
    console.error('Upload icon error:', error);
    showToast('选择图标失败', 'error');
  }
}

function confirmIconSelection() {
  // 更新显示的图标
  updateVersionIcon(selectedIcon, customIconPath);
  closeIconPicker();
}

function updateVersionIcon(iconType, customPath) {
  const iconWrapper = document.getElementById('settings-version-icon');
  if (!iconWrapper) return;
  
  // 移除所有图标类型类
  iconWrapper.className = 'version-icon';
  
  if (customPath) {
    // 自定义图标
    iconWrapper.innerHTML = `<img src="${customPath}" alt="icon" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;">`;
    iconWrapper.classList.add('custom');
  } else {
    // 预设图标 - 使用MC风格PNG图标
    const iconMap = {
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
    
    const iconName = iconMap[iconType] || 'grass';
    iconWrapper.classList.add(iconType);
    iconWrapper.innerHTML = `<img src="../../assets/icons/${iconName}.png" alt="${iconType}" class="version-icon-img">`;
  }
}


// ═══════════════════════════════════════════════════════════
// Mods 管理
// ═══════════════════════════════════════════════════════════

let currentMods = [];
let modsSearchText = '';
let currentWorlds = [];
let worldsSearchText = '';
let currentResourcepacks = [];
let resourcepacksSearchText = '';
let selectedIcon = 'grass';
let customIconPath = null;

async function loadModsList(versionId) {
  const modsList = document.getElementById('mods-list');
  if (!modsList) return;
  
  const loadingText = getI18n('instances.settings.mods.loading') || '加载中...';
  modsList.innerHTML = `<div class="mods-empty"><i class="ri-loader-4-line spin"></i><span>${loadingText}</span></div>`;
  
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    if (!mcDir) {
      renderModsList([]);
      return;
    }
    
    // 检查版本隔离设置
    const settings = versionSettings[versionId] || {};
    let modsDir;
    
    if (settings.versionIsolation) {
      modsDir = `${mcDir}/versions/${versionId}/mods`;
    } else {
      modsDir = `${mcDir}/mods`;
    }
    
    // 扫描 mods 目录
    const result = await ipcRenderer.invoke('scan-mods', modsDir);
    
    if (result && result.success) {
      currentMods = result.mods || [];
    } else {
      currentMods = [];
    }
    
    renderModsList(currentMods);
  } catch (error) {
    console.error('Load mods error:', error);
    currentMods = [];
    renderModsList([]);
  }
}

function renderModsList(mods) {
  const modsList = document.getElementById('mods-list');
  const enabledCount = document.getElementById('mods-enabled-count');
  const totalCount = document.getElementById('mods-total-count');
  
  if (!modsList) return;
  
  // 过滤搜索
  const filtered = mods.filter(mod => {
    if (!modsSearchText) return true;
    return mod.name.toLowerCase().includes(modsSearchText.toLowerCase()) ||
           (mod.id && mod.id.toLowerCase().includes(modsSearchText.toLowerCase()));
  });
  
  // 更新统计
  const enabled = mods.filter(m => m.enabled).length;
  if (enabledCount) enabledCount.textContent = enabled;
  if (totalCount) totalCount.textContent = mods.length;
  
  if (filtered.length === 0) {
    const emptyText = mods.length === 0 
      ? (getI18n('instances.settings.mods.empty') || '暂无 Mod')
      : (getI18n('instances.settings.mods.noResults') || '没有匹配的 Mod');
    modsList.innerHTML = `<div class="mods-empty"><i class="ri-puzzle-line"></i><span>${emptyText}</span></div>`;
    return;
  }
  
  modsList.innerHTML = filtered.map(mod => {
    const loaderClass = mod.loader ? mod.loader.toLowerCase() : 'default';
    return `
    <div class="mod-item ${mod.enabled ? '' : 'disabled'}" data-file="${escapeHtml(mod.file)}">
      <div class="mod-icon ${loaderClass}"><i class="ri-puzzle-2-fill"></i></div>
      <div class="mod-info">
        <div class="mod-name" title="${escapeHtml(mod.name)}">${escapeHtml(mod.name)}</div>
        <div class="mod-meta">
          ${mod.version ? `<span><i class="ri-price-tag-3-line"></i>${escapeHtml(mod.version)}</span>` : ''}
          ${mod.size ? `<span><i class="ri-file-line"></i>${formatFileSize(mod.size)}</span>` : ''}
          ${mod.loader ? `<span class="mod-loader ${mod.loader}">${mod.loader}</span>` : ''}
        </div>
      </div>
      <div class="mod-actions">
        <button class="mod-action-btn" data-action="info" data-file="${escapeHtml(mod.file)}" title="${getI18n('instances.settings.mods.info') || '详情'}">
          <i class="ri-information-line"></i>
        </button>
        <button class="mod-action-btn danger" data-action="delete" data-file="${escapeHtml(mod.file)}" title="${getI18n('instances.settings.mods.delete') || '删除'}">
          <i class="ri-delete-bin-line"></i>
        </button>
      </div>
      <label class="mod-toggle">
        <input type="checkbox" ${mod.enabled ? 'checked' : ''} data-file="${escapeHtml(mod.file)}">
        <span class="slider"></span>
      </label>
    </div>`;
  }).join('');
  
  // 绑定事件
  modsList.querySelectorAll('.mod-toggle input').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      toggleMod(e.target.dataset.file, e.target.checked);
    });
  });
  
  modsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteMod(btn.dataset.file));
  });
  
  modsList.querySelectorAll('[data-action="info"]').forEach(btn => {
    btn.addEventListener('click', () => showModInfo(btn.dataset.file));
  });
}

async function toggleMod(file, enabled) {
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let modsDir;
    
    if (settings.versionIsolation) {
      modsDir = `${mcDir}/versions/${editingVersionId}/mods`;
    } else {
      modsDir = `${mcDir}/mods`;
    }
    
    const result = await ipcRenderer.invoke('toggle-mod', modsDir, file, enabled);
    
    if (result && result.success) {
      // 更新本地数据
      const mod = currentMods.find(m => m.file === file);
      if (mod) {
        mod.enabled = enabled;
        mod.file = result.newFile || mod.file;
      }
      renderModsList(currentMods);
    } else {
      showToast(result?.error || '操作失败', 'error');
      // 恢复状态
      await loadModsList(editingVersionId);
    }
  } catch (error) {
    console.error('Toggle mod error:', error);
    showToast('操作失败: ' + error.message, 'error');
  }
}

async function deleteMod(file) {
  const mod = currentMods.find(m => m.file === file);
  const confirmText = getI18n('instances.settings.mods.confirmDelete') || `确定要删除 ${mod?.name || file} 吗？`;
  
  if (!confirm(confirmText)) return;
  
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let modsDir;
    
    if (settings.versionIsolation) {
      modsDir = `${mcDir}/versions/${editingVersionId}/mods`;
    } else {
      modsDir = `${mcDir}/mods`;
    }
    
    const result = await ipcRenderer.invoke('delete-mod', modsDir, file);
    
    if (result && result.success) {
      currentMods = currentMods.filter(m => m.file !== file);
      renderModsList(currentMods);
      showToast(getI18n('instances.settings.mods.deleted') || '已删除', 'success');
    } else {
      showToast(result?.error || '删除失败', 'error');
    }
  } catch (error) {
    console.error('Delete mod error:', error);
    showToast('删除失败: ' + error.message, 'error');
  }
}

function showModInfo(file) {
  const mod = currentMods.find(m => m.file === file);
  if (!mod) return;
  
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <div class="dialog-header">
        <i class="ri-puzzle-line dialog-icon"></i>
        <h3>${escapeHtml(mod.name)}</h3>
        <button class="dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="dialog-body">
        <div class="mod-info-grid">
          ${mod.id ? `<div class="info-row"><span class="info-label">ID</span><span class="info-value">${escapeHtml(mod.id)}</span></div>` : ''}
          ${mod.version ? `<div class="info-row"><span class="info-label">${getI18n('instances.settings.mods.version') || '版本'}</span><span class="info-value">${escapeHtml(mod.version)}</span></div>` : ''}
          ${mod.loader ? `<div class="info-row"><span class="info-label">${getI18n('instances.settings.mods.loader') || '加载器'}</span><span class="info-value">${mod.loader}</span></div>` : ''}
          ${mod.mcVersion ? `<div class="info-row"><span class="info-label">${getI18n('instances.settings.mods.mcVersion') || 'MC 版本'}</span><span class="info-value">${escapeHtml(mod.mcVersion)}</span></div>` : ''}
          ${mod.authors ? `<div class="info-row"><span class="info-label">${getI18n('instances.settings.mods.authors') || '作者'}</span><span class="info-value">${escapeHtml(mod.authors)}</span></div>` : ''}
          <div class="info-row"><span class="info-label">${getI18n('instances.settings.mods.file') || '文件'}</span><span class="info-value">${escapeHtml(mod.file)}</span></div>
          ${mod.size ? `<div class="info-row"><span class="info-label">${getI18n('instances.settings.mods.size') || '大小'}</span><span class="info-value">${formatFileSize(mod.size)}</span></div>` : ''}
        </div>
        ${mod.description ? `<div class="mod-description"><p>${escapeHtml(mod.description)}</p></div>` : ''}
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" data-action="close">${getI18n('common.close') || '关闭'}</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  
  const closeDialog = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };
  
  overlay.querySelector('.dialog-close')?.addEventListener('click', closeDialog);
  overlay.querySelector('[data-action="close"]')?.addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
}

async function addMod() {
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let modsDir;
    
    if (settings.versionIsolation) {
      modsDir = `${mcDir}/versions/${editingVersionId}/mods`;
    } else {
      modsDir = `${mcDir}/mods`;
    }
    
    // 使用 Tauri 文件对话框选择文件
    const { open } = window.__TAURI__.dialog;
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Mod Files',
        extensions: ['jar']
      }]
    });
    
    if (!selected || (Array.isArray(selected) && selected.length === 0)) {
      return; // 用户取消
    }
    
    const files = Array.isArray(selected) ? selected : [selected];
    let addedCount = 0;
    
    for (const filePath of files) {
      const result = await ipcRenderer.invoke('copy-mod-to-dir', filePath, modsDir);
      if (result && result.success) {
        addedCount++;
      }
    }
    
    if (addedCount > 0) {
      showToast(`${getI18n('instances.settings.mods.added') || '已添加'} ${addedCount} 个 Mod`, 'success');
      await loadModsList(editingVersionId);
    }
  } catch (error) {
    console.error('Add mod error:', error);
    if (error.toString().includes('cancelled')) {
      return; // 用户取消
    }
    showToast('添加失败: ' + error.message, 'error');
  }
}


// ═══════════════════════════════════════════════════════════
// 存档管理
// ═══════════════════════════════════════════════════════════

async function loadWorldsList(versionId) {
  const worldsList = document.getElementById('worlds-list');
  if (!worldsList) return;
  
  worldsList.innerHTML = `<div class="worlds-empty"><i class="ri-loader-4-line spin"></i><span>加载中...</span></div>`;
  
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    if (!mcDir) {
      renderWorldsList([]);
      return;
    }
    
    const settings = versionSettings[versionId] || {};
    let savesDir;
    
    if (settings.versionIsolation) {
      savesDir = `${mcDir}/versions/${versionId}/saves`;
    } else {
      savesDir = `${mcDir}/saves`;
    }
    
    const result = await ipcRenderer.invoke('scan-worlds', savesDir);
    
    if (result && result.success) {
      currentWorlds = result.worlds || [];
    } else {
      currentWorlds = [];
    }
    
    renderWorldsList(currentWorlds);
  } catch (error) {
    console.error('Load worlds error:', error);
    currentWorlds = [];
    renderWorldsList([]);
  }
}

function renderWorldsList(worlds) {
  const worldsList = document.getElementById('worlds-list');
  if (!worldsList) return;
  
  const filtered = worlds.filter(world => {
    if (!worldsSearchText) return true;
    return world.name.toLowerCase().includes(worldsSearchText.toLowerCase());
  });
  
  if (filtered.length === 0) {
    worldsList.innerHTML = `<div class="worlds-empty"><i class="ri-earth-line"></i><span>暂无存档</span></div>`;
    return;
  }
  
  worldsList.innerHTML = filtered.map(world => `
    <div class="world-item" data-folder="${escapeHtml(world.folder)}">
      <div class="world-icon">
        ${world.icon ? `<img src="${world.icon}" alt="">` : '<i class="ri-earth-line"></i>'}
      </div>
      <div class="world-info">
        <div class="world-name">${escapeHtml(world.name)}</div>
        <div class="world-meta">
          ${world.gameMode ? `<span><i class="ri-gamepad-line"></i>${world.gameMode}</span>` : ''}
          ${world.lastPlayed ? `<span><i class="ri-time-line"></i>${formatDate(world.lastPlayed)}</span>` : ''}
          ${world.size ? `<span><i class="ri-folder-line"></i>${formatFileSize(world.size)}</span>` : ''}
        </div>
      </div>
      <div class="world-actions">
        <button class="mod-action-btn" data-action="open" data-folder="${escapeHtml(world.folder)}" title="打开文件夹">
          <i class="ri-folder-open-line"></i>
        </button>
        <button class="mod-action-btn danger" data-action="delete" data-folder="${escapeHtml(world.folder)}" title="删除">
          <i class="ri-delete-bin-line"></i>
        </button>
      </div>
    </div>
  `).join('');
  
  // 绑定事件
  worldsList.querySelectorAll('[data-action="open"]').forEach(btn => {
    btn.addEventListener('click', () => openWorldFolder(btn.dataset.folder));
  });
  
  worldsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteWorld(btn.dataset.folder));
  });
}

async function openWorldsFolder() {
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let savesDir;
    
    if (settings.versionIsolation) {
      savesDir = `${mcDir}/versions/${editingVersionId}/saves`;
    } else {
      savesDir = `${mcDir}/saves`;
    }
    
    await ipcRenderer.invoke('open-folder', savesDir);
  } catch (error) {
    console.error('Open worlds folder error:', error);
    showToast('无法打开存档文件夹', 'error');
  }
}

async function openWorldFolder(folder) {
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let savesDir;
    
    if (settings.versionIsolation) {
      savesDir = `${mcDir}/versions/${editingVersionId}/saves`;
    } else {
      savesDir = `${mcDir}/saves`;
    }
    
    await ipcRenderer.invoke('open-folder', `${savesDir}/${folder}`);
  } catch (error) {
    console.error('Open world folder error:', error);
    showToast('无法打开文件夹', 'error');
  }
}

async function deleteWorld(folder) {
  const world = currentWorlds.find(w => w.folder === folder);
  if (!confirm(`确定要删除存档 "${world?.name || folder}" 吗？此操作不可恢复！`)) return;
  
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let savesDir;
    
    if (settings.versionIsolation) {
      savesDir = `${mcDir}/versions/${editingVersionId}/saves`;
    } else {
      savesDir = `${mcDir}/saves`;
    }
    
    const result = await ipcRenderer.invoke('delete-world', savesDir, folder);
    
    if (result && result.success) {
      currentWorlds = currentWorlds.filter(w => w.folder !== folder);
      renderWorldsList(currentWorlds);
      showToast('存档已删除', 'success');
    } else {
      showToast(result?.error || '删除失败', 'error');
    }
  } catch (error) {
    console.error('Delete world error:', error);
    showToast('删除失败: ' + error.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// 资源包管理
// ═══════════════════════════════════════════════════════════

async function loadResourcepacksList(versionId) {
  const resourcepacksList = document.getElementById('resourcepacks-list');
  if (!resourcepacksList) return;
  
  resourcepacksList.innerHTML = `<div class="resourcepacks-empty"><i class="ri-loader-4-line spin"></i><span>加载中...</span></div>`;
  
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    if (!mcDir) {
      renderResourcepacksList([]);
      return;
    }
    
    const settings = versionSettings[versionId] || {};
    let resourcepacksDir;
    
    if (settings.versionIsolation) {
      resourcepacksDir = `${mcDir}/versions/${versionId}/resourcepacks`;
    } else {
      resourcepacksDir = `${mcDir}/resourcepacks`;
    }
    
    const result = await ipcRenderer.invoke('scan-resourcepacks', resourcepacksDir);
    
    if (result && result.success) {
      currentResourcepacks = result.resourcepacks || [];
    } else {
      currentResourcepacks = [];
    }
    
    renderResourcepacksList(currentResourcepacks);
  } catch (error) {
    console.error('Load resourcepacks error:', error);
    currentResourcepacks = [];
    renderResourcepacksList([]);
  }
}

function renderResourcepacksList(resourcepacks) {
  const resourcepacksList = document.getElementById('resourcepacks-list');
  if (!resourcepacksList) return;
  
  const filtered = resourcepacks.filter(pack => {
    if (!resourcepacksSearchText) return true;
    return pack.name.toLowerCase().includes(resourcepacksSearchText.toLowerCase());
  });
  
  if (filtered.length === 0) {
    resourcepacksList.innerHTML = `<div class="resourcepacks-empty"><i class="ri-palette-line"></i><span>暂无资源包</span></div>`;
    return;
  }
  
  resourcepacksList.innerHTML = filtered.map(pack => {
    // 转换图标路径
    let iconSrc = '';
    if (pack.icon) {
      if (window.__TAURI__?.core?.convertFileSrc) {
        iconSrc = window.__TAURI__.core.convertFileSrc(pack.icon);
      } else if (window.parent?.__TAURI__?.core?.convertFileSrc) {
        iconSrc = window.parent.__TAURI__.core.convertFileSrc(pack.icon);
      } else {
        iconSrc = pack.icon;
      }
    }
    
    // 解析 Minecraft 格式化文本
    const formattedDesc = pack.description ? parseMinecraftText(pack.description) : '';
    
    return `
    <div class="resourcepack-item" data-file="${escapeHtml(pack.file)}">
      <div class="resourcepack-icon">
        ${iconSrc ? `<img src="${iconSrc}" alt="" onerror="this.parentElement.innerHTML='<i class=\\'ri-palette-line\\'></i>'">` : '<i class="ri-palette-line"></i>'}
      </div>
      <div class="resourcepack-info">
        <div class="resourcepack-name">${escapeHtml(pack.name)}</div>
        <div class="resourcepack-desc">${formattedDesc}</div>
        <div class="resourcepack-meta">
          ${pack.size ? `<span><i class="ri-file-line"></i>${formatFileSize(pack.size)}</span>` : ''}
        </div>
      </div>
      <div class="resourcepack-actions">
        <button class="mod-action-btn danger" data-action="delete" data-file="${escapeHtml(pack.file)}" title="删除">
          <i class="ri-delete-bin-line"></i>
        </button>
      </div>
    </div>`;
  }).join('');
  
  // 绑定事件
  resourcepacksList.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteResourcepack(btn.dataset.file));
  });
}

// 解析 Minecraft 格式化文本 (§ 代码)
function parseMinecraftText(text) {
  if (!text) return '';
  
  // Minecraft 颜色代码映射
  const colorMap = {
    '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
    '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
    '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
    'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
  };
  
  let result = '';
  let currentColor = '';
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isStrike = false;
  
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '§' && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      i++; // 跳过代码字符
      
      if (colorMap[code]) {
        currentColor = colorMap[code];
      } else if (code === 'l') {
        isBold = true;
      } else if (code === 'o') {
        isItalic = true;
      } else if (code === 'n') {
        isUnderline = true;
      } else if (code === 'm') {
        isStrike = true;
      } else if (code === 'r') {
        // 重置所有格式
        currentColor = '';
        isBold = false;
        isItalic = false;
        isUnderline = false;
        isStrike = false;
      }
    } else {
      // 构建样式
      let style = '';
      if (currentColor) style += `color:${currentColor};`;
      if (isBold) style += 'font-weight:bold;';
      if (isItalic) style += 'font-style:italic;';
      if (isUnderline) style += 'text-decoration:underline;';
      if (isStrike) style += 'text-decoration:line-through;';
      
      if (style) {
        result += `<span style="${style}">${escapeHtml(text[i])}</span>`;
      } else {
        result += escapeHtml(text[i]);
      }
    }
  }
  
  return result;
}

async function openResourcepacksFolder() {
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let resourcepacksDir;
    
    if (settings.versionIsolation) {
      resourcepacksDir = `${mcDir}/versions/${editingVersionId}/resourcepacks`;
    } else {
      resourcepacksDir = `${mcDir}/resourcepacks`;
    }
    
    await ipcRenderer.invoke('open-folder', resourcepacksDir);
  } catch (error) {
    console.error('Open resourcepacks folder error:', error);
    showToast('无法打开资源包文件夹', 'error');
  }
}

async function addResourcepack() {
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let resourcepacksDir;
    
    if (settings.versionIsolation) {
      resourcepacksDir = `${mcDir}/versions/${editingVersionId}/resourcepacks`;
    } else {
      resourcepacksDir = `${mcDir}/resourcepacks`;
    }
    
    const { open } = window.__TAURI__.dialog;
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Resource Packs',
        extensions: ['zip']
      }]
    });
    
    if (!selected || (Array.isArray(selected) && selected.length === 0)) {
      return;
    }
    
    const files = Array.isArray(selected) ? selected : [selected];
    let addedCount = 0;
    
    for (const filePath of files) {
      const result = await ipcRenderer.invoke('copy-file-to-dir', filePath, resourcepacksDir);
      if (result && result.success) {
        addedCount++;
      }
    }
    
    if (addedCount > 0) {
      showToast(`已添加 ${addedCount} 个资源包`, 'success');
      await loadResourcepacksList(editingVersionId);
    }
  } catch (error) {
    console.error('Add resourcepack error:', error);
    showToast('添加失败: ' + error.message, 'error');
  }
}

async function deleteResourcepack(file) {
  const pack = currentResourcepacks.find(p => p.file === file);
  if (!confirm(`确定要删除资源包 "${pack?.name || file}" 吗？`)) return;
  
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let resourcepacksDir;
    
    if (settings.versionIsolation) {
      resourcepacksDir = `${mcDir}/versions/${editingVersionId}/resourcepacks`;
    } else {
      resourcepacksDir = `${mcDir}/resourcepacks`;
    }
    
    const result = await ipcRenderer.invoke('delete-file', `${resourcepacksDir}/${file}`);
    
    if (result && result.success) {
      currentResourcepacks = currentResourcepacks.filter(p => p.file !== file);
      renderResourcepacksList(currentResourcepacks);
      showToast('资源包已删除', 'success');
    } else {
      showToast(result?.error || '删除失败', 'error');
    }
  } catch (error) {
    console.error('Delete resourcepack error:', error);
    showToast('删除失败: ' + error.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// Mods 文件夹和下载
// ═══════════════════════════════════════════════════════════

async function openModsFolder() {
  try {
    const mcDir = minecraftDirs[currentDirIndex];
    const settings = versionSettings[editingVersionId] || {};
    let modsDir;
    
    if (settings.versionIsolation) {
      modsDir = `${mcDir}/versions/${editingVersionId}/mods`;
    } else {
      modsDir = `${mcDir}/mods`;
    }
    
    await ipcRenderer.invoke('open-folder', modsDir);
  } catch (error) {
    console.error('Open mods folder error:', error);
    showToast('无法打开 Mods 文件夹', 'error');
  }
}

function openModsDownload() {
  // 通知父窗口跳转到下载页面的 Mods 标签
  notifyParent('navigate', { page: 'downloads', tab: 'mods' });
  closeSettings();
}

function openResourcepacksDownload() {
  // 通知父窗口跳转到下载页面的资源包标签
  notifyParent('navigate', { page: 'downloads', tab: 'resourcepacks' });
  closeSettings();
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}


// ═══════════════════════════════════════════════════════════
// 文件夹快速菜单
// ═══════════════════════════════════════════════════════════

// 新版本：直接操作元素，解决网格布局中多个相同 data-id 的问题
function toggleFolderMenuElement(btn, menu) {
  const isOpen = menu?.classList.contains('show');
  
  // 关闭所有菜单
  closeFolderMenus();
  
  // 如果之前是关闭的，则打开并定位
  if (!isOpen && menu && btn) {
    // 获取按钮在视口中的位置
    const rect = btn.getBoundingClientRect();
    const menuHeight = 280; // 预估菜单高度（包含新增的导出脚本选项）
    const menuWidth = 180;
    
    // 计算可用空间
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceRight = window.innerWidth - rect.left;
    const spaceLeft = rect.right;
    
    // 重置样式
    menu.style.top = 'auto';
    menu.style.bottom = 'auto';
    menu.style.left = 'auto';
    menu.style.right = 'auto';
    
    // 垂直定位：优先显示在下方
    if (spaceBelow >= menuHeight || spaceBelow > spaceAbove) {
      // 显示在下方
      menu.style.top = `${rect.bottom + 4}px`;
    } else {
      // 显示在上方
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    }
    
    // 水平定位：优先左对齐，如果超出则右对齐
    if (spaceRight >= menuWidth) {
      menu.style.left = `${rect.left}px`;
    } else if (spaceLeft >= menuWidth) {
      menu.style.right = `${window.innerWidth - rect.right}px`;
    } else {
      // 居中显示
      menu.style.left = `${Math.max(8, (window.innerWidth - menuWidth) / 2)}px`;
    }
    
    menu.classList.add('show');
  }
}

// 保留旧版本函数以兼容
function toggleFolderMenu(versionId) {
  const btn = document.querySelector(`.btn-menu[data-id="${versionId}"]`);
  const menu = document.querySelector(`.folder-menu[data-id="${versionId}"]`);
  toggleFolderMenuElement(btn, menu);
}

function closeFolderMenus() {
  document.querySelectorAll('.folder-menu.show').forEach(menu => {
    menu.classList.remove('show');
  });
}

async function handleFolderMenuAction(action, versionId) {
  const mcDir = minecraftDirs[currentDirIndex];
  if (!mcDir) {
    showToast('未选择游戏目录', 'error');
    return;
  }
  
  const settings = versionSettings[versionId] || {};
  const useIsolation = settings.versionIsolation;
  
  let targetPath = '';
  
  switch (action) {
    case 'game-dir':
      targetPath = mcDir;
      break;
    case 'version-dir':
      targetPath = `${mcDir}/versions/${versionId}`;
      break;
    case 'mods-dir':
      targetPath = useIsolation 
        ? `${mcDir}/versions/${versionId}/mods`
        : `${mcDir}/mods`;
      break;
    case 'saves-dir':
      targetPath = useIsolation
        ? `${mcDir}/versions/${versionId}/saves`
        : `${mcDir}/saves`;
      break;
    case 'resourcepacks-dir':
      targetPath = useIsolation
        ? `${mcDir}/versions/${versionId}/resourcepacks`
        : `${mcDir}/resourcepacks`;
      break;
    case 'logs-dir':
      targetPath = useIsolation
        ? `${mcDir}/versions/${versionId}/logs`
        : `${mcDir}/logs`;
      break;
    case 'export-script':
      // 导出启动脚本
      await exportLaunchScript(versionId);
      return;
    default:
      return;
  }
  
  try {
    await ipcRenderer.invoke('open-folder', targetPath);
  } catch (error) {
    console.error('Open folder error:', error);
    showToast('无法打开文件夹', 'error');
  }
}

// 导出启动脚本
async function exportLaunchScript(versionId) {
  try {
    // 使用 Tauri 的保存对话框
    const { save } = window.__TAURI__.dialog;
    const savePath = await save({
      defaultPath: `launch_${versionId}.bat`,
      filters: [{ name: '批处理文件', extensions: ['bat'] }]
    });
    
    if (!savePath) return; // 用户取消
    
    showToast('正在生成启动脚本...', 'info');
    
    const result = await ipcRenderer.invoke('generate-launch-script', { versionId, savePath });
    
    if (result.success) {
      showToast('启动脚本已导出', 'success');
    } else {
      showToast('导出失败: ' + (result.error || '未知错误'), 'error');
    }
  } catch (error) {
    console.error('Export script error:', error);
    showToast('导出失败: ' + error.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// 加载器安装弹窗
// ═══════════════════════════════════════════════════════════

let loaderInstallVersionId = null;
let loaderVersionsCache = {
  forge: {},
  fabric: [],
  quilt: [],
  neoforge: {}
};

function showLoaderInstallModal(versionId) {
  loaderInstallVersionId = versionId;
  
  // 检测游戏版本
  const version = versions.find(v => v.id === versionId);
  const gameVersion = version?.inheritsFrom || detectGameVersion(versionId) || versionId;
  
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay loader-install-modal';
  overlay.id = 'loader-install-overlay';
  overlay.innerHTML = `
    <div class="dialog large">
      <div class="dialog-header">
        <h3><i class="ri-download-2-line"></i> 安装加载器</h3>
        <button class="dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="dialog-body">
        <div class="loader-install-info">
          <span class="loader-install-version">版本: <strong>${versionId}</strong></span>
          <span class="loader-install-game">游戏版本: <strong>${gameVersion}</strong></span>
        </div>
        
        <div class="loader-tabs">
          <button class="loader-tab active" data-loader="fabric">
            <img src="../../assets/icons/fabric.png" alt="Fabric">
            <span>Fabric</span>
          </button>
          <button class="loader-tab" data-loader="forge">
            <img src="../../assets/icons/forge.png" alt="Forge">
            <span>Forge</span>
          </button>
          <button class="loader-tab" data-loader="quilt">
            <img src="../../assets/icons/quilt.png" alt="Quilt">
            <span>Quilt</span>
          </button>
        </div>
        
        <div class="loader-content">
          <div class="loader-version-select">
            <label>选择加载器版本</label>
            <select id="loader-version-select">
              <option value="">加载中...</option>
            </select>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" data-action="cancel">取消</button>
        <button class="btn-primary" data-action="install" id="loader-install-btn" disabled>
          <i class="ri-download-line"></i>
          <span>安装</span>
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  
  // 绑定事件
  const closeDialog = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
    loaderInstallVersionId = null;
  };
  
  overlay.querySelector('.dialog-close')?.addEventListener('click', closeDialog);
  overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', closeDialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  
  // 加载器标签切换
  overlay.querySelectorAll('.loader-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.loader-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLoaderVersionsForInstall(tab.dataset.loader, gameVersion);
    });
  });
  
  // 版本选择变化
  overlay.querySelector('#loader-version-select')?.addEventListener('change', (e) => {
    const installBtn = overlay.querySelector('#loader-install-btn');
    if (installBtn) {
      installBtn.disabled = !e.target.value;
    }
  });
  
  // 安装按钮
  overlay.querySelector('[data-action="install"]')?.addEventListener('click', async () => {
    const activeTab = overlay.querySelector('.loader-tab.active');
    const loaderType = activeTab?.dataset.loader;
    const loaderVersion = overlay.querySelector('#loader-version-select')?.value;
    
    if (!loaderType || !loaderVersion) return;
    
    await installLoaderForVersion(loaderType, gameVersion, loaderVersion);
    closeDialog();
  });
  
  // 默认加载 Fabric 版本
  loadLoaderVersionsForInstall('fabric', gameVersion);
}

async function loadLoaderVersionsForInstall(loaderType, gameVersion) {
  const select = document.querySelector('#loader-version-select');
  const installBtn = document.querySelector('#loader-install-btn');
  
  if (!select) return;
  
  select.innerHTML = '<option value="">加载中...</option>';
  if (installBtn) installBtn.disabled = true;
  
  try {
    let versions = [];
    
    switch (loaderType) {
      case 'fabric':
        if (loaderVersionsCache.fabric.length === 0) {
          const response = await fetch('https://meta.fabricmc.net/v2/versions/loader');
          loaderVersionsCache.fabric = await response.json();
        }
        versions = loaderVersionsCache.fabric.filter(l => l.stable).slice(0, 20);
        break;
        
      case 'forge':
        if (!loaderVersionsCache.forge[gameVersion]) {
          const result = await ipcRenderer.invoke('get-forge-versions', gameVersion);
          loaderVersionsCache.forge[gameVersion] = result || [];
        }
        versions = loaderVersionsCache.forge[gameVersion].slice(0, 30);
        break;
        
      case 'quilt':
        if (loaderVersionsCache.quilt.length === 0) {
          const response = await fetch('https://meta.quiltmc.org/v3/versions/loader');
          loaderVersionsCache.quilt = await response.json();
        }
        versions = loaderVersionsCache.quilt.slice(0, 20);
        break;
    }
    
    if (versions.length === 0) {
      select.innerHTML = '<option value="">此版本无可用加载器</option>';
      return;
    }
    
    select.innerHTML = '<option value="">选择版本</option>';
    versions.forEach(v => {
      const version = v.version || v;
      const label = loaderType === 'forge' && v.type 
        ? `${version} ${v.type === 'recommended' ? '(推荐)' : v.type === 'latest' ? '(最新)' : ''}`
        : version;
      select.innerHTML += `<option value="${version}">${label}</option>`;
    });
    
  } catch (error) {
    console.error('Load loader versions error:', error);
    select.innerHTML = '<option value="">加载失败</option>';
  }
}

async function installLoaderForVersion(loaderType, gameVersion, loaderVersion) {
  showToast(`正在安装 ${loaderType}...`, 'info');
  
  try {
    let result;
    
    switch (loaderType) {
      case 'fabric':
        result = await ipcRenderer.invoke('install-fabric', gameVersion, loaderVersion);
        break;
      case 'forge':
        result = await ipcRenderer.invoke('install-forge', gameVersion, loaderVersion);
        break;
      case 'quilt':
        result = await ipcRenderer.invoke('install-quilt', gameVersion, loaderVersion);
        break;
      default:
        throw new Error('不支持的加载器类型');
    }
    
    if (result.success) {
      showToast(`${loaderType} 安装成功`, 'success');
      await scanCurrentDir(); // 刷新版本列表
    } else {
      showToast(`安装失败: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Install loader error:', error);
    showToast(`安装失败: ${error.message}`, 'error');
  }
}
