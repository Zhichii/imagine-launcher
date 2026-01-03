// Downloads Page - 向导式安装
let mcVersions = [];
let installedVersions = [];
let currentFilter = 'all';
let i18nData = {};

// 向导状态
let wizardState = {
  mcVersion: null,
  mcVersionUrl: null,
  mcVersionType: null,
  selectedLoader: null,
  loaderVersion: null,
  addons: [],
  optifineVersion: null,
  optifineDownloadUrl: null,
  versionName: '',
  currentStep: 1,
  isInstalling: false
};

// 加载器兼容性 - OptiFine 是附加组件，可以和 Forge 一起安装
const LOADER_COMPAT = {
  fabric: ['fabricapi'],
  quilt: ['qsl'],
  forge: ['optifine'],
  neoforge: [],
  null: ['optifine']
};

// 缓存
let loaderVersionsCache = { forge: {}, fabric: [], quilt: [], neoforge: {}, optifine: {} };

// OptiFine 状态
let optifineVersions = [];
let allOptifineVersions = [];
let selectedOptifineVersion = null;
let optifineTypeFilter = 'stable';

// 初始化
document.addEventListener('DOMContentLoaded', init);

async function init() {
  let retries = 0;
  while (!window.ipcRenderer && retries < 50) {
    await new Promise(r => setTimeout(r, 50));
    retries++;
  }
  if (!window.ipcRenderer) return console.error('[Downloads] ipcRenderer not available');
  
  await loadI18n();
  initEventListeners();
  initOptifineEventListeners();
  await loadInstalledVersions();
  await loadMcVersions();
}

async function loadI18n() {
  try {
    const config = await ipcRenderer.invoke('get-config');
    const lang = config.app?.language || 'zh-CN';
    const res = await fetch(`../../locales/${lang}.json`);
    i18nData = await res.json();
  } catch (e) { console.error('i18n load failed:', e); }
}

async function loadInstalledVersions() {
  try {
    const result = await ipcRenderer.invoke('scan-versions');
    if (result.success) installedVersions = result.versions.map(v => v.id);
  } catch (e) { console.error('Failed to load installed versions:', e); }
}

async function loadMcVersions() {
  const grid = document.getElementById('mc-version-grid');
  grid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line spin"></i><span>加载版本列表...</span></div>';
  
  try {
    const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    const data = await res.json();
    mcVersions = data.versions;
    renderMcVersions();
    populateLoaderMcVersions();
  } catch (e) {
    console.error('Failed to load MC versions:', e);
    grid.innerHTML = '<div class="empty-state"><i class="ri-error-warning-line"></i><span>加载失败</span></div>';
  }
}

function populateLoaderMcVersions() {
  const select = document.getElementById('loader-mc-version');
  if (!select) return;
  const releases = mcVersions.filter(v => v.type === 'release');
  select.innerHTML = '<option value="">选择游戏版本</option>' + releases.slice(0, 50).map(v => `<option value="${v.id}">${v.id}</option>`).join('');
}

function renderMcVersions() {
  const grid = document.getElementById('mc-version-grid');
  const search = document.getElementById('mc-search')?.value?.toLowerCase() || '';
  
  let filtered = mcVersions.filter(v => {
    if (search && !v.id.toLowerCase().includes(search)) return false;
    if (currentFilter === 'release') return v.type === 'release';
    if (currentFilter === 'snapshot') return v.type === 'snapshot';
    if (currentFilter === 'old') return v.type === 'old_beta' || v.type === 'old_alpha';
    return true;
  }).slice(0, 100);
  
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><i class="ri-folder-line"></i><span>没有找到版本</span></div>';
    return;
  }
  
  grid.innerHTML = filtered.map(v => {
    const installed = installedVersions.includes(v.id);
    const typeClass = v.type === 'release' ? 'release' : v.type === 'snapshot' ? 'snapshot' : 'old';
    const typeText = v.type === 'release' ? '正式版' : v.type === 'snapshot' ? '快照' : '旧版本';
    const date = v.releaseTime ? new Date(v.releaseTime).toLocaleDateString() : '';
    return `
      <div class="version-card ${installed ? 'installed' : ''}" data-id="${v.id}" data-url="${v.url}" data-type="${v.type}">
        <div class="version-card-header">
          <div class="version-card-icon"><img src="../../assets/icons/grass.png" class="version-icon-img"></div>
          <div class="version-card-badges">
            <span class="badge ${typeClass}">${typeText}</span>
            ${installed ? '<span class="badge installed">已安装</span>' : ''}
          </div>
        </div>
        <div class="version-card-name">${v.id}</div>
        <div class="version-card-date">${date}</div>
      </div>`;
  }).join('');
  
  grid.querySelectorAll('.version-card').forEach(card => {
    card.onclick = () => openInstallWizard(card.dataset.id, card.dataset.url, card.dataset.type);
  });
}

// ═══════════════════════════════════════════════════════════
// 安装向导
// ═══════════════════════════════════════════════════════════
function openInstallWizard(versionId, versionUrl, versionType) {
  wizardState = {
    mcVersion: versionId,
    mcVersionUrl: versionUrl,
    mcVersionType: versionType,
    selectedLoader: null,
    loaderVersion: null,
    addons: [],
    optifineVersion: null,
    optifineDownloadUrl: null,
    versionName: versionId,
    currentStep: 1,
    isInstalling: false
  };
  
  document.getElementById('selected-version-name').textContent = `Minecraft ${versionId}`;
  document.getElementById('selected-version-type').textContent = 
    versionType === 'release' ? '正式版' : versionType === 'snapshot' ? '快照' : '旧版本';
  document.getElementById('wizard-version-name').value = versionId;
  
  document.querySelectorAll('.component-item').forEach(item => {
    item.classList.remove('selected', 'disabled');
    const input = item.querySelector('input');
    if (input) input.checked = false;
  });
  document.getElementById('loader-version-row').style.display = 'none';
  const optifineRow = document.getElementById('optifine-version-row');
  if (optifineRow) optifineRow.style.display = 'none';
  
  updateAddonCompatibility();
  goToWizardStep(1);
  document.getElementById('install-wizard-modal').classList.add('show');
}

function closeInstallWizard() {
  if (wizardState.isInstalling && !confirm('安装正在进行中，确定要取消吗？')) return;
  document.getElementById('install-wizard-modal').classList.remove('show');
  wizardState.isInstalling = false;
}

function goToWizardStep(step) {
  wizardState.currentStep = step;
  
  document.querySelectorAll('.wizard-step').forEach(s => {
    const n = parseInt(s.dataset.step);
    s.classList.remove('active', 'done');
    if (n < step) s.classList.add('done');
    if (n === step) s.classList.add('active');
  });
  
  document.querySelectorAll('.wizard-page').forEach(p => p.classList.remove('active'));
  document.getElementById(`wizard-step-${step}`).classList.add('active');
  
  const prevBtn = document.getElementById('wizard-prev');
  const nextBtn = document.getElementById('wizard-next');
  const cancelBtn = document.getElementById('wizard-cancel');
  
  prevBtn.style.display = step > 1 && step < 3 ? 'flex' : 'none';
  cancelBtn.style.display = step < 3 ? 'flex' : 'none';
  nextBtn.style.display = step < 3 ? 'flex' : 'none';
  
  if (step === 2) {
    nextBtn.innerHTML = '<i class="ri-download-line"></i><span>开始安装</span>';
  } else {
    nextBtn.innerHTML = '<span>下一步</span><i class="ri-arrow-right-s-line"></i>';
  }
}

async function wizardNext() {
  if (wizardState.currentStep === 1) {
    updateVersionName();
    updateSummary();
    goToWizardStep(2);
  } else if (wizardState.currentStep === 2) {
    wizardState.versionName = document.getElementById('wizard-version-name').value.trim() || wizardState.mcVersion;
    goToWizardStep(3);
    await startInstallation();
  }
}

function wizardPrev() {
  if (wizardState.currentStep === 2) goToWizardStep(1);
}

function selectLoader(loader) {
  const item = document.querySelector(`.loader-item[data-component="${loader}"]`);
  if (!item || item.classList.contains('disabled')) return;
  
  if (wizardState.selectedLoader === loader) {
    wizardState.selectedLoader = null;
    wizardState.loaderVersion = null;
    item.classList.remove('selected');
    item.querySelector('input').checked = false;
    document.getElementById('loader-version-row').style.display = 'none';
  } else {
    document.querySelectorAll('.loader-item').forEach(el => {
      el.classList.remove('selected');
      const inp = el.querySelector('input');
      if (inp) inp.checked = false;
    });
    
    wizardState.selectedLoader = loader;
    wizardState.loaderVersion = null;
    item.classList.add('selected');
    item.querySelector('input').checked = true;
    
    const versionRow = document.getElementById('loader-version-row');
    const versionSelect = document.getElementById('wizard-loader-version');
    versionRow.style.display = 'flex';
    versionSelect.innerHTML = '<option value="">加载中...</option>';
    loadLoaderVersions(loader, versionSelect);
  }
  
  updateAddonCompatibility();
}

function updateAddonCompatibility() {
  const loader = wizardState.selectedLoader;
  const compatAddons = LOADER_COMPAT[loader] || LOADER_COMPAT[null] || [];
  
  document.querySelectorAll('.addon-item').forEach(item => {
    const addon = item.dataset.component;
    const isCompat = addon === 'optifine' 
      ? (!loader || loader === 'forge')
      : (!loader || compatAddons.includes(addon));
    
    item.classList.toggle('disabled', !isCompat);
    if (!isCompat) {
      item.classList.remove('selected');
      const input = item.querySelector('input');
      if (input) input.checked = false;
      wizardState.addons = wizardState.addons.filter(a => a !== addon);
      if (addon === 'optifine') {
        wizardState.optifineVersion = null;
        const optifineRow = document.getElementById('optifine-version-row');
        if (optifineRow) optifineRow.style.display = 'none';
      }
    }
  });
}

async function selectAddon(addon) {
  const item = document.querySelector(`.addon-item[data-component="${addon}"]`);
  if (!item || item.classList.contains('disabled')) return;
  
  const input = item.querySelector('input');
  const isSelected = item.classList.toggle('selected');
  if (input) input.checked = isSelected;
  
  if (isSelected) {
    if (!wizardState.addons.includes(addon)) wizardState.addons.push(addon);
    
    if (addon === 'optifine') {
      const optifineRow = document.getElementById('optifine-version-row');
      const optifineSelect = document.getElementById('wizard-optifine-version');
      if (optifineRow && optifineSelect) {
        optifineRow.style.display = 'flex';
        optifineSelect.innerHTML = '<option value="">加载中...</option>';
        await loadOptifineVersionsForWizard(wizardState.mcVersion, optifineSelect);
      }
    }
  } else {
    wizardState.addons = wizardState.addons.filter(a => a !== addon);
    if (addon === 'optifine') {
      wizardState.optifineVersion = null;
      const optifineRow = document.getElementById('optifine-version-row');
      if (optifineRow) optifineRow.style.display = 'none';
    }
  }
}

async function loadLoaderVersions(loader, select) {
  try {
    if (loader === 'fabric') {
      if (!loaderVersionsCache.fabric.length) {
        const res = await fetch('https://meta.fabricmc.net/v2/versions/loader');
        loaderVersionsCache.fabric = await res.json();
      }
      select.innerHTML = '<option value="">选择版本</option>' + 
        loaderVersionsCache.fabric.filter(l => l.stable).slice(0, 15).map(l => 
          `<option value="${l.version}">${l.version}</option>`).join('');
    } else if (loader === 'forge') {
      const mc = wizardState.mcVersion;
      if (!loaderVersionsCache.forge[mc]) {
        loaderVersionsCache.forge[mc] = await ipcRenderer.invoke('get-forge-versions', mc) || [];
      }
      const vers = loaderVersionsCache.forge[mc];
      if (!vers.length) { select.innerHTML = '<option value="">此版本无 Forge</option>'; return; }
      select.innerHTML = '<option value="">选择版本</option>' + 
        vers.slice(0, 20).map(v => `<option value="${v.version}">${v.version}${v.type === 'recommended' ? ' ★' : ''}</option>`).join('');
    } else if (loader === 'quilt') {
      if (!loaderVersionsCache.quilt.length) {
        const res = await fetch('https://meta.quiltmc.org/v3/versions/loader');
        loaderVersionsCache.quilt = await res.json();
      }
      select.innerHTML = '<option value="">选择版本</option>' + 
        loaderVersionsCache.quilt.slice(0, 15).map(l => `<option value="${l.version}">${l.version}</option>`).join('');
    } else if (loader === 'neoforge') {
      select.innerHTML = '<option value="">暂不支持</option>';
    }
  } catch (e) {
    console.error(`Failed to load ${loader} versions:`, e);
    select.innerHTML = '<option value="">加载失败</option>';
  }
}

async function loadOptifineVersionsForWizard(gameVersion, select) {
  if (!select) select = document.getElementById('wizard-optifine-version');
  if (!select) return;
  
  try {
    const mc = gameVersion || wizardState.mcVersion;
    if (!loaderVersionsCache.optifine[mc]) {
      const result = await ipcRenderer.invoke('get-optifine-versions', mc);
      loaderVersionsCache.optifine[mc] = result.success ? result.versions : [];
    }
    const vers = loaderVersionsCache.optifine[mc];
    // 只显示稳定版
    const stableVers = vers.filter(v => !v.is_preview);
    if (!stableVers.length) { 
      select.innerHTML = '<option value="">此版本无 OptiFine</option>'; 
      return; 
    }
    select.innerHTML = '<option value="">选择版本</option>' + 
      stableVers.map(v => `<option value="${v.version}" data-url="${v.download_url}">${v.type}_${v.patch}</option>`).join('');
  } catch (e) {
    console.error('Failed to load OptiFine versions:', e);
    select.innerHTML = '<option value="">加载失败</option>';
  }
}

function updateVersionName() {
  let name = wizardState.mcVersion;
  const loaderNames = { fabric: 'Fabric', forge: 'Forge', quilt: 'Quilt', neoforge: 'NeoForge' };
  if (wizardState.selectedLoader) name += `-${loaderNames[wizardState.selectedLoader]}`;
  if (wizardState.addons.includes('optifine')) name += '-OptiFine';
  document.getElementById('wizard-version-name').value = name;
  wizardState.versionName = name;
}

function updateSummary() {
  document.getElementById('summary-game-version').textContent = wizardState.mcVersion;
  
  const loaderRow = document.getElementById('summary-loader-row');
  const loaderVal = document.getElementById('summary-loader');
  if (wizardState.selectedLoader) {
    loaderRow.style.display = 'flex';
    const names = { fabric: 'Fabric', forge: 'Forge', quilt: 'Quilt', neoforge: 'NeoForge' };
    loaderVal.textContent = `${names[wizardState.selectedLoader]} ${wizardState.loaderVersion || ''}`;
  } else {
    loaderRow.style.display = 'none';
  }
  
  const addonsRow = document.getElementById('summary-addons-row');
  const addonsVal = document.getElementById('summary-addons');
  if (wizardState.addons.length) {
    addonsRow.style.display = 'flex';
    const addonNames = { fabricapi: 'Fabric API', qsl: 'QSL/QFAPI', optifine: 'OptiFine' };
    addonsVal.textContent = wizardState.addons.map(a => addonNames[a] || a).join(', ');
  } else {
    addonsRow.style.display = 'none';
  }
}


// ═══════════════════════════════════════════════════════════
// 安装流程
// ═══════════════════════════════════════════════════════════
async function startInstallation() {
  wizardState.isInstalling = true;
  
  const statusEl = document.getElementById('install-status');
  const progressFill = document.getElementById('install-progress-fill');
  const progressPercent = document.getElementById('install-progress-percent');
  const detailEl = document.getElementById('install-detail');
  const speedEl = document.getElementById('install-speed');
  const progressIcon = document.querySelector('.progress-icon i');
  
  const setProgress = (pct, status, detail = '') => {
    progressFill.style.width = `${pct}%`;
    progressPercent.textContent = `${Math.round(pct)}%`;
    if (status) statusEl.textContent = status;
    detailEl.textContent = detail;
  };
  
  setProgress(0, '准备安装...', '');
  speedEl.textContent = '';
  progressIcon.className = 'ri-download-cloud-line';
  progressIcon.style.animation = '';
  
  try {
    // 1. 下载基础游戏
    setProgress(5, '下载游戏文件...');
    const mcResult = await ipcRenderer.invoke('download-minecraft-version', wizardState.mcVersion, wizardState.mcVersionUrl);
    if (!mcResult.success) throw new Error(mcResult.error || '下载游戏失败');
    
    let baseVersionId = wizardState.mcVersion;
    
    // 2. 安装加载器
    if (wizardState.selectedLoader && wizardState.loaderVersion) {
      setProgress(40, `安装 ${wizardState.selectedLoader}...`);
      let loaderResult;
      if (wizardState.selectedLoader === 'fabric') {
        loaderResult = await ipcRenderer.invoke('install-fabric', wizardState.mcVersion, wizardState.loaderVersion);
      } else if (wizardState.selectedLoader === 'forge') {
        loaderResult = await ipcRenderer.invoke('install-forge', wizardState.mcVersion, wizardState.loaderVersion);
      } else if (wizardState.selectedLoader === 'quilt') {
        loaderResult = await ipcRenderer.invoke('install-quilt', wizardState.mcVersion, wizardState.loaderVersion);
      }
      if (loaderResult && !loaderResult.success) throw new Error(loaderResult.error || '安装加载器失败');
      if (loaderResult?.version_id) baseVersionId = loaderResult.version_id;
    }
    
    // 3. 安装 OptiFine（如果选择了）
    if (wizardState.addons.includes('optifine') && wizardState.optifineVersion) {
      setProgress(60, '下载 OptiFine...');
      const downloadUrl = wizardState.optifineDownloadUrl;
      
      if (downloadUrl) {
        const downloadResult = await ipcRenderer.invoke('download-optifine', 
          wizardState.mcVersion, 
          wizardState.optifineVersion,
          downloadUrl
        );
        
        if (!downloadResult.success) throw new Error(downloadResult.error || 'OptiFine 下载失败');
        
        setProgress(70, '安装 OptiFine...');
        const installResult = await ipcRenderer.invoke('install-optifine', 
          baseVersionId, 
          downloadResult.installer_path
        );
        
        if (!installResult.success) throw new Error(installResult.error || 'OptiFine 安装失败');
      }
    }
    
    // 4. 补全游戏文件
    setProgress(85, '补全游戏文件...');
    try {
      await ipcRenderer.invoke('complete-game-files', wizardState.mcVersion);
    } catch (e) { console.warn('File completion warning:', e); }
    
    setProgress(100, '安装完成！');
    progressIcon.className = 'ri-check-line';
    progressIcon.style.animation = 'none';
    
    showToast(`${wizardState.versionName} 安装完成`, 'success');
    await loadInstalledVersions();
    renderMcVersions();
    
    await delay(1500);
    closeInstallWizard();
  } catch (error) {
    console.error('Installation failed:', error);
    statusEl.textContent = '安装失败: ' + error.message;
    progressIcon.className = 'ri-error-warning-line';
    progressIcon.style.animation = 'none';
    showToast('安装失败: ' + error.message, 'error');
  }
  
  wizardState.isInstalling = false;
}

// ═══════════════════════════════════════════════════════════
// 加载器安装弹窗
// ═══════════════════════════════════════════════════════════
let currentLoaderType = null;

function openLoaderInstallModal(loaderType) {
  currentLoaderType = loaderType;
  const modal = document.getElementById('loader-install-modal');
  const title = document.getElementById('loader-install-title');
  const names = { fabric: 'Fabric', forge: 'Forge', quilt: 'Quilt' };
  
  title.textContent = `安装 ${names[loaderType]}`;
  document.getElementById('loader-version-label').textContent = `${names[loaderType]} 版本`;
  document.getElementById('loader-version').innerHTML = '<option value="">选择游戏版本后加载</option>';
  document.getElementById('loader-install-confirm').disabled = true;
  document.getElementById('loader-mc-version').value = '';
  modal.classList.add('show');
}

function closeLoaderInstallModal() {
  document.getElementById('loader-install-modal').classList.remove('show');
  currentLoaderType = null;
}

async function onLoaderMcVersionChange(mcVersion) {
  if (!mcVersion || !currentLoaderType) return;
  const select = document.getElementById('loader-version');
  const btn = document.getElementById('loader-install-confirm');
  select.innerHTML = '<option value="">加载中...</option>';
  btn.disabled = true;
  
  const oldMcVersion = wizardState.mcVersion;
  wizardState.mcVersion = mcVersion;
  await loadLoaderVersions(currentLoaderType, select);
  wizardState.mcVersion = oldMcVersion;
  btn.disabled = false;
}

async function confirmLoaderInstall() {
  const mcVersion = document.getElementById('loader-mc-version').value;
  const loaderVersion = document.getElementById('loader-version').value;
  if (!mcVersion || !loaderVersion || !currentLoaderType) {
    showToast('请选择游戏版本和加载器版本', 'error');
    return;
  }
  
  closeLoaderInstallModal();
  
  wizardState = { 
    mcVersion, 
    selectedLoader: currentLoaderType, 
    loaderVersion, 
    addons: [],
    optifineVersion: null,
    versionName: `${mcVersion}-${currentLoaderType}`, 
    currentStep: 3, 
    isInstalling: true 
  };
  document.getElementById('install-wizard-modal').classList.add('show');
  goToWizardStep(3);
  
  const statusEl = document.getElementById('install-status');
  const progressFill = document.getElementById('install-progress-fill');
  const progressPercent = document.getElementById('install-progress-percent');
  const progressIcon = document.querySelector('.progress-icon i');
  
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  statusEl.textContent = `安装 ${currentLoaderType}...`;
  progressIcon.className = 'ri-download-cloud-line';
  
  try {
    let result;
    if (currentLoaderType === 'fabric') result = await ipcRenderer.invoke('install-fabric', mcVersion, loaderVersion);
    else if (currentLoaderType === 'forge') result = await ipcRenderer.invoke('install-forge', mcVersion, loaderVersion);
    else if (currentLoaderType === 'quilt') result = await ipcRenderer.invoke('install-quilt', mcVersion, loaderVersion);
    
    if (result?.success) {
      progressFill.style.width = '100%';
      progressPercent.textContent = '100%';
      statusEl.textContent = '安装完成！';
      progressIcon.className = 'ri-check-line';
      progressIcon.style.animation = 'none';
      showToast(`${currentLoaderType} 安装完成`, 'success');
      await loadInstalledVersions();
      renderMcVersions();
      await delay(1500);
      closeInstallWizard();
    } else throw new Error(result?.error || '安装失败');
  } catch (e) {
    statusEl.textContent = '安装失败: ' + e.message;
    progressIcon.className = 'ri-error-warning-line';
    progressIcon.style.animation = 'none';
    showToast('安装失败: ' + e.message, 'error');
  }
  wizardState.isInstalling = false;
}

// ═══════════════════════════════════════════════════════════
// OptiFine 独立安装弹窗（带版本类型筛选）
// ═══════════════════════════════════════════════════════════
function initOptifineEventListeners() {
  const modal = document.getElementById('optifine-install-modal');
  const closeBtn = document.getElementById('optifine-install-close');
  const cancelBtn = document.getElementById('optifine-cancel');
  const installBtn = document.getElementById('optifine-install');
  const mcVersionSelect = document.getElementById('optifine-mc-version');
  const optifineVersionSelect = document.getElementById('optifine-version');

  [closeBtn, cancelBtn].forEach(btn => btn?.addEventListener('click', closeOptifineModal));
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeOptifineModal(); });

  mcVersionSelect?.addEventListener('change', async (e) => {
    const gameVersion = e.target.value;
    if (gameVersion) {
      await loadOptifineVersionsForModal(gameVersion);
    } else {
      optifineVersionSelect.innerHTML = '<option value="">选择游戏版本后加载</option>';
      updateOptifineVersionInfo(null);
    }
  });

  optifineVersionSelect?.addEventListener('change', (e) => {
    const versionId = e.target.value;
    const version = allOptifineVersions.find(v => v.version === versionId);
    updateOptifineVersionInfo(version);
    selectedOptifineVersion = version;
    if (installBtn) installBtn.disabled = !version;
  });

  installBtn?.addEventListener('click', installOptifineFromModal);
  
  // 版本类型筛选按钮
  document.querySelectorAll('.type-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      optifineTypeFilter = btn.dataset.type;
      renderOptifineVersions();
    });
  });
}

async function openOptifineModal() {
  const modal = document.getElementById('optifine-install-modal');
  if (!modal) return;

  selectedOptifineVersion = null;
  optifineVersions = [];
  allOptifineVersions = [];
  optifineTypeFilter = 'stable';
  
  // 重置筛选按钮
  document.querySelectorAll('.type-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === 'stable');
  });
  
  await populateOptifineGameVersions();
  
  const mcVersionSelect = document.getElementById('optifine-mc-version');
  const optifineVersionSelect = document.getElementById('optifine-version');
  const installBtn = document.getElementById('optifine-install');
  
  if (mcVersionSelect) mcVersionSelect.value = '';
  if (optifineVersionSelect) optifineVersionSelect.innerHTML = '<option value="">选择游戏版本后加载</option>';
  if (installBtn) installBtn.disabled = true;
  
  updateOptifineVersionInfo(null);
  modal.classList.add('show');
}

function closeOptifineModal() {
  document.getElementById('optifine-install-modal')?.classList.remove('show');
}

async function populateOptifineGameVersions() {
  const select = document.getElementById('optifine-mc-version');
  if (!select) return;

  if (installedVersions.length === 0) {
    select.innerHTML = '<option value="">请先安装游戏版本</option>';
    return;
  }

  const releases = installedVersions.filter(versionId => /^\d+\.\d+(\.\d+)?$/.test(versionId));
  if (releases.length === 0) {
    select.innerHTML = '<option value="">没有找到兼容的游戏版本</option>';
    return;
  }

  select.innerHTML = '<option value="">选择游戏版本</option>' + 
    releases.map(v => `<option value="${v}">${v}</option>`).join('');
}

async function loadOptifineVersionsForModal(gameVersion) {
  const select = document.getElementById('optifine-version');
  if (!select) return;

  select.innerHTML = '<option value="">加载中...</option>';
  
  try {
    const result = await ipcRenderer.invoke('get-optifine-versions', gameVersion);
    
    if (result.success && result.versions.length > 0) {
      allOptifineVersions = result.versions;
      
      // 排序：稳定版优先，然后按版本号降序
      allOptifineVersions.sort((a, b) => {
        if (a.is_preview !== b.is_preview) return a.is_preview ? 1 : -1;
        return b.patch.localeCompare(a.patch, undefined, { numeric: true });
      });
      
      renderOptifineVersions();
    } else {
      select.innerHTML = '<option value="">该版本暂无 OptiFine</option>';
      allOptifineVersions = [];
    }
  } catch (error) {
    console.error('Failed to load OptiFine versions:', error);
    select.innerHTML = '<option value="">加载失败</option>';
    showToast('加载 OptiFine 版本失败: ' + error, 'error');
  }
}

function renderOptifineVersions() {
  const select = document.getElementById('optifine-version');
  if (!select) return;
  
  let filtered = allOptifineVersions;
  if (optifineTypeFilter === 'stable') {
    filtered = allOptifineVersions.filter(v => !v.is_preview);
  } else if (optifineTypeFilter === 'preview') {
    filtered = allOptifineVersions.filter(v => v.is_preview);
  }
  
  if (!filtered.length) {
    select.innerHTML = `<option value="">没有${optifineTypeFilter === 'stable' ? '稳定' : optifineTypeFilter === 'preview' ? '预览' : ''}版本</option>`;
    return;
  }
  
  select.innerHTML = '<option value="">选择 OptiFine 版本</option>' + 
    filtered.map(v => {
      const statusText = v.is_preview ? ' [预览]' : ' [稳定]';
      return `<option value="${v.version}">${v.type}_${v.patch}${statusText}</option>`;
    }).join('');
  
  selectedOptifineVersion = null;
  document.getElementById('optifine-install').disabled = true;
  updateOptifineVersionInfo(null);
}

function updateOptifineVersionInfo(version) {
  const infoDiv = document.getElementById('optifine-version-info');
  const typeSpan = document.getElementById('optifine-type');
  const statusSpan = document.getElementById('optifine-status');
  
  if (!version) {
    if (infoDiv) infoDiv.style.display = 'none';
    return;
  }
  
  if (infoDiv) infoDiv.style.display = 'block';
  if (typeSpan) typeSpan.textContent = `${version.type}_${version.patch}`;
  if (statusSpan) {
    statusSpan.textContent = version.is_preview ? '预览版 (可能不稳定)' : '稳定版';
    statusSpan.style.color = version.is_preview ? 'var(--warning-color)' : 'var(--success-color)';
  }
}

async function installOptifineFromModal() {
  if (!selectedOptifineVersion) return;
  
  const mcVersionSelect = document.getElementById('optifine-mc-version');
  const installBtn = document.getElementById('optifine-install');
  const gameVersion = mcVersionSelect?.value;
  
  if (!gameVersion) {
    showToast('请选择游戏版本', 'error');
    return;
  }
  
  if (installBtn) {
    installBtn.disabled = true;
    installBtn.innerHTML = '<i class="ri-loader-4-line spin"></i><span>下载中...</span>';
  }
  
  try {
    showToast('正在下载 OptiFine...', 'info');
    
    const downloadResult = await ipcRenderer.invoke('download-optifine', 
      gameVersion, 
      selectedOptifineVersion.version, 
      selectedOptifineVersion.download_url
    );
    
    if (!downloadResult.success) throw new Error(downloadResult.error || '下载失败');
    
    if (installBtn) installBtn.innerHTML = '<i class="ri-loader-4-line spin"></i><span>安装中...</span>';
    showToast('正在安装 OptiFine...', 'info');
    
    const installResult = await ipcRenderer.invoke('install-optifine', 
      gameVersion, 
      downloadResult.installer_path
    );
    
    if (installResult.success) {
      showToast(`OptiFine 安装成功！版本: ${installResult.version_id}`, 'success');
      closeOptifineModal();
      await loadInstalledVersions();
    } else {
      throw new Error(installResult.error || '安装失败');
    }
  } catch (error) {
    console.error('OptiFine installation failed:', error);
    showToast('OptiFine 安装失败: ' + error.message, 'error');
  } finally {
    if (installBtn) {
      installBtn.disabled = false;
      installBtn.innerHTML = '<i class="ri-download-line"></i><span>安装 OptiFine</span>';
    }
  }
}


// ═══════════════════════════════════════════════════════════
// 事件监听
// ═══════════════════════════════════════════════════════════
function initEventListeners() {
  document.getElementById('back-btn')?.addEventListener('click', () => {
    window.parent.postMessage({ action: 'navigate', page: 'home' }, '*');
  });
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
  
  document.getElementById('mc-search')?.addEventListener('input', renderMcVersions);
  
  document.querySelectorAll('#tab-minecraft .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-minecraft .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderMcVersions();
    });
  });
  
  document.getElementById('refresh-mc')?.addEventListener('click', loadMcVersions);
  
  // 向导
  document.getElementById('wizard-close')?.addEventListener('click', closeInstallWizard);
  document.getElementById('wizard-cancel')?.addEventListener('click', closeInstallWizard);
  document.getElementById('wizard-next')?.addEventListener('click', wizardNext);
  document.getElementById('wizard-prev')?.addEventListener('click', wizardPrev);
  
  // 加载器选择
  document.querySelectorAll('.loader-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      selectLoader(item.dataset.component);
    });
  });
  
  // 附加组件选择
  document.querySelectorAll('.addon-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      selectAddon(item.dataset.component);
    });
  });
  
  document.getElementById('wizard-loader-version')?.addEventListener('change', e => {
    wizardState.loaderVersion = e.target.value;
  });
  
  document.getElementById('wizard-optifine-version')?.addEventListener('change', e => {
    const select = e.target;
    const selectedOption = select.options[select.selectedIndex];
    wizardState.optifineVersion = e.target.value;
    if (selectedOption?.dataset?.url) {
      wizardState.optifineDownloadUrl = selectedOption.dataset.url;
    }
  });
  
  // 加载器安装按钮
  document.querySelectorAll('.btn-install-loader').forEach(btn => {
    btn.addEventListener('click', () => {
      const loader = btn.dataset.loader;
      if (loader === 'optifine') {
        openOptifineModal();
      } else {
        openLoaderInstallModal(loader);
      }
    });
  });
  
  document.getElementById('loader-install-close')?.addEventListener('click', closeLoaderInstallModal);
  document.getElementById('loader-install-cancel')?.addEventListener('click', closeLoaderInstallModal);
  document.getElementById('loader-install-confirm')?.addEventListener('click', confirmLoaderInstall);
  document.getElementById('loader-mc-version')?.addEventListener('change', e => onLoaderMcVersionChange(e.target.value));
  document.getElementById('loader-version')?.addEventListener('change', e => {
    document.getElementById('loader-install-confirm').disabled = !e.target.value;
  });
  
  ipcRenderer.on('download-progress', (_e, data) => {
    if (!wizardState.isInstalling) return;
    const fill = document.getElementById('install-progress-fill');
    const pct = document.getElementById('install-progress-percent');
    const status = document.getElementById('install-status');
    const detail = document.getElementById('install-detail');
    const speed = document.getElementById('install-speed');
    
    if (data.percent !== undefined) { fill.style.width = `${data.percent}%`; pct.textContent = `${Math.round(data.percent)}%`; }
    if (data.status) status.textContent = data.status;
    if (data.file) detail.textContent = data.file;
    if (data.speed > 0) { speed.textContent = data.speedText || formatSpeed(data.speed); speed.style.display = 'block'; }
    else speed.style.display = 'none';
  });
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════
const delay = ms => new Promise(r => setTimeout(r, ms));
const formatSpeed = b => b >= 1048576 ? `${(b/1048576).toFixed(2)} MB/s` : b >= 1024 ? `${(b/1024).toFixed(2)} KB/s` : `${b} B/s`;

function showToast(msg, type = 'info') {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="ri-${type === 'success' ? 'check' : type === 'error' ? 'close' : 'information'}-line"></i><span>${msg}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'toastOut 0.25s ease forwards'; setTimeout(() => toast.remove(), 250); }, 3000);
}
