// 模组下载页面 - Liquid Glass Design
const MODRINTH_API = 'https://api.modrinth.com/v2';

// 推荐模组列表 (Modrinth slug)
const RECOMMENDED_MODS = [
  'sodium', 'lithium', 'iris', 'modmenu', 'fabric-api',
  'jei', 'xaeros-minimap', 'journeymap', 'create', 'appleskin',
  'jade', 'roughly-enough-items'
];

let mcVersions = [];
let installedVersions = [];
let installedVersionIds = [];
let selectedGameInstance = null;
let allRecommendedMods = []; // 缓存所有推荐模组数据

// 模组搜索状态
let modsState = {
  searchQuery: '',
  gameVersion: '',
  loader: '',
  sort: 'relevance',
  page: 0,
  totalPages: 1,
  results: [],
  selectedMod: null,
  selectedVersion: null,
  modVersions: [],
  dependencies: []
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  let retries = 0;
  while (!window.ipcRenderer && retries < 50) {
    await new Promise(r => setTimeout(r, 50));
    retries++;
  }
  if (!window.ipcRenderer) return console.error('[Mods] ipcRenderer not available');
  
  initEventListeners();
  await loadInstalledVersions();
  await loadMcVersions();
  await loadRecommendedMods();
}

async function loadInstalledVersions() {
  try {
    const result = await ipcRenderer.invoke('scan-versions');
    if (result.success) {
      installedVersions = result.versions;
      installedVersionIds = result.versions.map(v => v.id);
      populateGameInstanceSelect();
    }
  } catch (e) {
    console.error('Failed to load installed versions:', e);
  }
}

function populateGameInstanceSelect() {
  const select = document.getElementById('game-instance-select');
  if (!select) return;
  
  select.innerHTML = '<option value="">不指定（手动选择版本）</option>' +
    installedVersions.map(v => {
      const loader = v.loader || 'vanilla';
      const loaderText = loader !== 'vanilla' ? ` [${getLoaderDisplayName(loader)}]` : '';
      const mcVersion = extractMcVersion(v);
      return `<option value="${v.id}" data-loader="${loader}" data-mc-version="${mcVersion}">${v.id}${loaderText}</option>`;
    }).join('');
}

function extractMcVersion(version) {
  if (version.inherits_from || version.inheritsFrom) {
    return version.inherits_from || version.inheritsFrom;
  }
  const match = version.id.match(/^(\d+\.\d+(?:\.\d+)?)/);
  if (match) return match[1];
  return version.id;
}

function getLoaderDisplayName(loader) {
  const names = { 'fabric': 'Fabric', 'forge': 'Forge', 'quilt': 'Quilt', 'neoforge': 'NeoForge', 'vanilla': '原版' };
  return names[loader?.toLowerCase()] || loader;
}

// 获取当前筛选条件
function getCurrentFilters() {
  return {
    gameVersion: document.getElementById('mods-game-version')?.value || '',
    loader: document.getElementById('mods-loader')?.value || ''
  };
}

// 游戏实例选择变化
function onGameInstanceChange() {
  const select = document.getElementById('game-instance-select');
  const infoEl = document.getElementById('game-selector-info');
  const mcVersionBadge = document.getElementById('game-mc-version');
  const loaderBadge = document.getElementById('game-loader');
  
  const selectedOption = select.options[select.selectedIndex];
  
  if (!select.value) {
    selectedGameInstance = null;
    infoEl.style.display = 'none';
    document.getElementById('mods-game-version').value = '';
    document.getElementById('mods-loader').value = '';
  } else {
    const loader = selectedOption.dataset.loader || 'vanilla';
    const mcVersion = selectedOption.dataset.mcVersion || '';
    
    selectedGameInstance = { id: select.value, loader, mcVersion };
    
    infoEl.style.display = 'flex';
    mcVersionBadge.innerHTML = `<i class="ri-price-tag-3-line"></i>${mcVersion || '未知'}`;
    
    const loaderName = getLoaderDisplayName(loader);
    loaderBadge.innerHTML = `<i class="ri-puzzle-line"></i>${loaderName}`;
    loaderBadge.className = `game-info-badge loader ${loader}`;
    
    // 自动设置筛选器
    if (mcVersion) {
      const gameVersionSelect = document.getElementById('mods-game-version');
      for (let opt of gameVersionSelect.options) {
        if (opt.value === mcVersion) {
          gameVersionSelect.value = mcVersion;
          break;
        }
      }
    }
    
    if (loader && loader !== 'vanilla') {
      document.getElementById('mods-loader').value = loader;
    }
  }
  
  // 自动刷新列表
  refreshCurrentView();
}

// 筛选器变化时刷新
function onFilterChange() {
  modsState.page = 0;
  refreshCurrentView();
}

// 刷新当前视图
function refreshCurrentView() {
  if (modsState.searchQuery) {
    searchMods();
  } else {
    filterAndRenderRecommendedMods();
  }
}

async function loadMcVersions() {
  try {
    const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    const data = await res.json();
    mcVersions = data.versions;
    populateGameVersions();
  } catch (e) {
    console.error('Failed to load MC versions:', e);
  }
}

function populateGameVersions() {
  const select = document.getElementById('mods-game-version');
  if (!select) return;
  
  const releases = mcVersions.filter(v => v.type === 'release').slice(0, 30);
  select.innerHTML = '<option value="">所有版本</option>' + 
    releases.map(v => `<option value="${v.id}">${v.id}</option>`).join('');
}

// 加载推荐模组（获取完整数据用于筛选）
async function loadRecommendedMods() {
  const grid = document.getElementById('recommended-grid');
  grid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line spin"></i><span>加载推荐模组...</span></div>';
  
  try {
    const slugs = RECOMMENDED_MODS.slice(0, 12);
    allRecommendedMods = [];
    
    for (const slug of slugs) {
      try {
        // 获取项目信息
        const res = await fetch(`${MODRINTH_API}/project/${slug}`);
        if (res.ok) {
          const mod = await res.json();
          allRecommendedMods.push(mod);
        }
      } catch (e) {
        console.warn(`Failed to load mod ${slug}:`, e);
      }
    }
    
    if (allRecommendedMods.length === 0) {
      grid.innerHTML = '<div class="empty-state"><i class="ri-wifi-off-line"></i><span>无法加载推荐模组</span></div>';
      return;
    }
    
    filterAndRenderRecommendedMods();
  } catch (error) {
    console.error('Failed to load recommended mods:', error);
    grid.innerHTML = '<div class="empty-state"><i class="ri-error-warning-line"></i><span>加载失败</span></div>';
  }
}

// 根据筛选条件过滤并渲染推荐模组
function filterAndRenderRecommendedMods() {
  const grid = document.getElementById('recommended-grid');
  const filters = getCurrentFilters();
  
  // 过滤模组
  let filteredMods = allRecommendedMods.filter(mod => {
    // 检查游戏版本
    if (filters.gameVersion && mod.game_versions) {
      if (!mod.game_versions.includes(filters.gameVersion)) {
        return false;
      }
    }
    // 检查加载器
    if (filters.loader && mod.loaders) {
      if (!mod.loaders.includes(filters.loader)) {
        return false;
      }
    }
    return true;
  });
  
  if (filteredMods.length === 0) {
    const hasFilters = filters.gameVersion || filters.loader;
    grid.innerHTML = `<div class="empty-state"><i class="ri-filter-off-line"></i><span>${hasFilters ? '没有符合筛选条件的推荐模组' : '无法加载推荐模组'}</span></div>`;
    return;
  }
  
  grid.innerHTML = filteredMods.map(mod => `
    <div class="mod-card recommended" data-id="${mod.id}" data-slug="${mod.slug}">
      <div class="mod-card-icon">
        ${mod.icon_url ? `<img src="${mod.icon_url}" alt="${mod.title}">` : '<i class="ri-puzzle-line"></i>'}
      </div>
      <div class="mod-card-info">
        <div class="mod-card-title">${escapeHtml(mod.title)}</div>
        <div class="mod-card-desc">${escapeHtml(mod.description || '')}</div>
        <div class="mod-card-meta">
          <span><i class="ri-download-line"></i>${formatNumber(mod.downloads)}</span>
        </div>
      </div>
    </div>
  `).join('');
  
  grid.querySelectorAll('.mod-card').forEach(card => {
    card.onclick = () => openModDetailModal(card.dataset.id, card.dataset.slug);
  });
}

// 搜索模组（应用筛选条件）
async function searchMods() {
  const searchInput = document.getElementById('mods-search');
  const query = searchInput?.value?.trim() || '';
  
  if (!query) {
    document.getElementById('recommended-section').style.display = 'block';
    document.getElementById('search-results-section').style.display = 'none';
    modsState.searchQuery = '';
    filterAndRenderRecommendedMods();
    return;
  }
  
  document.getElementById('recommended-section').style.display = 'none';
  document.getElementById('search-results-section').style.display = 'flex';
  
  const grid = document.getElementById('mods-grid');
  const filters = getCurrentFilters();
  
  modsState.searchQuery = query;
  modsState.gameVersion = filters.gameVersion;
  modsState.loader = filters.loader;
  modsState.sort = document.getElementById('mods-sort')?.value || 'relevance';
  
  grid.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line spin"></i><span>搜索中...</span></div>';
  
  try {
    const facets = [['project_type:mod']];
    if (modsState.gameVersion) facets.push([`versions:${modsState.gameVersion}`]);
    if (modsState.loader) facets.push([`categories:${modsState.loader}`]);
    
    const params = new URLSearchParams({
      query: query,
      facets: JSON.stringify(facets),
      offset: (modsState.page * 20).toString(),
      limit: '20',
      index: modsState.sort
    });
    
    const response = await fetch(`${MODRINTH_API}/search?${params}`);
    if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
    
    const data = await response.json();
    modsState.results = data.hits || [];
    modsState.totalPages = Math.ceil((data.total_hits || 0) / 20);
    
    document.getElementById('results-count').textContent = `找到 ${data.total_hits || 0} 个模组`;
    
    renderModsResults();
    updateModsPagination();
  } catch (error) {
    console.error('Mods search failed:', error);
    grid.innerHTML = `<div class="empty-state"><i class="ri-error-warning-line"></i><span>搜索失败: ${error.message}</span></div>`;
  }
}

function renderModsResults() {
  const grid = document.getElementById('mods-grid');
  
  if (!modsState.results.length) {
    grid.innerHTML = '<div class="empty-state"><i class="ri-folder-line"></i><span>没有找到模组</span></div>';
    return;
  }
  
  grid.innerHTML = modsState.results.map(mod => `
    <div class="mod-card" data-id="${mod.project_id}" data-slug="${mod.slug}">
      <div class="mod-card-icon">
        ${mod.icon_url ? `<img src="${mod.icon_url}" alt="${mod.title}">` : '<i class="ri-puzzle-line"></i>'}
      </div>
      <div class="mod-card-info">
        <div class="mod-card-title">${escapeHtml(mod.title)}</div>
        <div class="mod-card-author">${escapeHtml(mod.author || '未知作者')}</div>
        <div class="mod-card-desc">${escapeHtml(mod.description || '')}</div>
        <div class="mod-card-meta">
          <span><i class="ri-download-line"></i>${formatNumber(mod.downloads)}</span>
          <span><i class="ri-time-line"></i>${formatDate(mod.date_modified)}</span>
        </div>
      </div>
    </div>
  `).join('');
  
  grid.querySelectorAll('.mod-card').forEach(card => {
    card.onclick = () => openModDetailModal(card.dataset.id, card.dataset.slug);
  });
}

function updateModsPagination() {
  const pagination = document.getElementById('mods-pagination');
  const prevBtn = document.getElementById('mods-prev');
  const nextBtn = document.getElementById('mods-next');
  const pageInfo = document.getElementById('mods-page-info');
  
  if (modsState.totalPages <= 1) {
    pagination.style.display = 'none';
    return;
  }
  
  pagination.style.display = 'flex';
  prevBtn.disabled = modsState.page === 0;
  nextBtn.disabled = modsState.page >= modsState.totalPages - 1;
  pageInfo.textContent = `${modsState.page + 1} / ${modsState.totalPages}`;
}


// 模组详情弹窗
async function openModDetailModal(projectId, slug) {
  const modal = document.getElementById('mod-detail-modal');
  if (!modal) return;
  
  modsState.selectedMod = null;
  modsState.selectedVersion = null;
  modsState.modVersions = [];
  modsState.dependencies = [];
  
  // 重置UI
  document.getElementById('mod-detail-icon-img').src = '';
  document.getElementById('mod-detail-title').textContent = '加载中...';
  document.getElementById('mod-detail-author').textContent = '';
  document.getElementById('mod-detail-desc').textContent = '';
  document.getElementById('mod-detail-downloads').textContent = '-';
  document.getElementById('mod-detail-updated').textContent = '-';
  document.getElementById('mod-detail-categories').innerHTML = '';
  document.getElementById('mod-versions-list').innerHTML = '<div class="loading-state"><i class="ri-loader-4-line spin"></i><span>加载版本...</span></div>';
  document.getElementById('mod-detail-download').disabled = true;
  document.getElementById('mod-dependencies-section').style.display = 'none';
  document.getElementById('recommended-version-hint').style.display = 'none';
  
  modal.classList.add('show');
  
  try {
    const projectRes = await fetch(`${MODRINTH_API}/project/${projectId}`);
    if (!projectRes.ok) throw new Error('获取模组信息失败');
    const project = await projectRes.json();
    
    modsState.selectedMod = project;
    
    if (project.icon_url) {
      document.getElementById('mod-detail-icon-img').src = project.icon_url;
    }
    document.getElementById('mod-detail-title').textContent = project.title;
    document.getElementById('mod-detail-author').textContent = `by ${project.team || '未知'}`;
    document.getElementById('mod-detail-desc').textContent = project.description || '';
    document.getElementById('mod-detail-downloads').textContent = formatNumber(project.downloads);
    document.getElementById('mod-detail-updated').textContent = formatDate(project.updated);
    document.getElementById('mod-detail-page').href = `https://modrinth.com/mod/${slug}`;
    
    const categoriesEl = document.getElementById('mod-detail-categories');
    categoriesEl.innerHTML = (project.categories || []).map(cat => 
      `<span class="category-tag">${escapeHtml(cat)}</span>`
    ).join('');
    
    const versionsRes = await fetch(`${MODRINTH_API}/project/${projectId}/version`);
    if (!versionsRes.ok) throw new Error('获取版本列表失败');
    modsState.modVersions = await versionsRes.json();
    
    await loadDependencies();
    populateModVersionFilters();
    
    // 如果有筛选条件，自动应用
    const filters = getCurrentFilters();
    if (filters.gameVersion || filters.loader || selectedGameInstance) {
      const gameSelect = document.getElementById('mod-version-game');
      const loaderSelect = document.getElementById('mod-version-loader');
      
      const targetMcVersion = filters.gameVersion || (selectedGameInstance?.mcVersion);
      const targetLoader = filters.loader || (selectedGameInstance?.loader !== 'vanilla' ? selectedGameInstance?.loader : '');
      
      if (targetMcVersion) {
        for (let opt of gameSelect.options) {
          if (opt.value === targetMcVersion) {
            gameSelect.value = targetMcVersion;
            break;
          }
        }
      }
      
      if (targetLoader) {
        loaderSelect.value = targetLoader;
      }
      
      // 显示推荐提示
      const hintEl = document.getElementById('recommended-version-hint');
      const hintText = document.getElementById('recommended-hint-text');
      hintEl.style.display = 'flex';
      if (selectedGameInstance) {
        hintText.textContent = `已根据 ${selectedGameInstance.id} 自动筛选兼容版本`;
      } else {
        hintText.textContent = `已根据筛选条件自动筛选兼容版本`;
      }
    }
    
    renderModVersions();
  } catch (error) {
    console.error('Failed to load mod details:', error);
    document.getElementById('mod-versions-list').innerHTML = 
      `<div class="empty-state"><i class="ri-error-warning-line"></i><span>加载失败: ${error.message}</span></div>`;
  }
}

async function loadDependencies() {
  const depSection = document.getElementById('mod-dependencies-section');
  const depList = document.getElementById('dependencies-list');
  
  if (!modsState.modVersions.length) {
    depSection.style.display = 'none';
    return;
  }
  
  const latestVersion = modsState.modVersions[0];
  const dependencies = latestVersion.dependencies || [];
  
  if (dependencies.length === 0) {
    depSection.style.display = 'none';
    return;
  }
  
  const depProjects = [];
  for (const dep of dependencies) {
    if (dep.project_id) {
      try {
        const res = await fetch(`${MODRINTH_API}/project/${dep.project_id}`);
        if (res.ok) {
          const project = await res.json();
          depProjects.push({ ...project, dependency_type: dep.dependency_type });
        }
      } catch (e) {
        console.warn('Failed to load dependency:', dep.project_id);
      }
    }
  }
  
  if (depProjects.length === 0) {
    depSection.style.display = 'none';
    return;
  }
  
  modsState.dependencies = depProjects;
  depSection.style.display = 'block';
  
  depList.innerHTML = depProjects.map(dep => `
    <div class="dependency-item" data-id="${dep.id}" data-slug="${dep.slug}">
      <div class="dependency-info">
        <div class="dependency-icon">
          ${dep.icon_url ? `<img src="${dep.icon_url}" alt="">` : ''}
        </div>
        <span class="dependency-name">${escapeHtml(dep.title)}</span>
        <span class="dependency-type ${dep.dependency_type}">${dep.dependency_type === 'required' ? '必需' : '可选'}</span>
      </div>
      <button class="btn-download-dep" data-id="${dep.id}" data-slug="${dep.slug}">
        <i class="ri-download-line"></i> 下载
      </button>
    </div>
  `).join('');
  
  depList.querySelectorAll('.btn-download-dep').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openModDetailModal(btn.dataset.id, btn.dataset.slug);
    };
  });
}

function closeModDetailModal() {
  document.getElementById('mod-detail-modal')?.classList.remove('show');
}

function populateModVersionFilters() {
  const gameVersions = new Set();
  const loaders = new Set();
  
  modsState.modVersions.forEach(v => {
    (v.game_versions || []).forEach(gv => gameVersions.add(gv));
    (v.loaders || []).forEach(l => loaders.add(l));
  });
  
  const gameSelect = document.getElementById('mod-version-game');
  const loaderSelect = document.getElementById('mod-version-loader');
  
  gameSelect.innerHTML = '<option value="">所有游戏版本</option>' + 
    Array.from(gameVersions).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map(v => `<option value="${v}">${v}</option>`).join('');
  
  loaderSelect.innerHTML = '<option value="">所有加载器</option>' + 
    Array.from(loaders).map(l => `<option value="${l}">${l}</option>`).join('');
}

function filterModVersions() {
  renderModVersions();
}

function renderModVersions() {
  const list = document.getElementById('mod-versions-list');
  const gameFilter = document.getElementById('mod-version-game')?.value || '';
  const loaderFilter = document.getElementById('mod-version-loader')?.value || '';
  
  let filtered = modsState.modVersions;
  if (gameFilter) {
    filtered = filtered.filter(v => (v.game_versions || []).includes(gameFilter));
  }
  if (loaderFilter) {
    filtered = filtered.filter(v => (v.loaders || []).includes(loaderFilter));
  }
  
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><i class="ri-folder-line"></i><span>没有找到匹配的版本</span></div>';
    return;
  }
  
  // 标记推荐版本
  const recommendedVersionIds = new Set();
  const targetMcVersion = gameFilter || selectedGameInstance?.mcVersion;
  const targetLoader = loaderFilter || (selectedGameInstance?.loader !== 'vanilla' ? selectedGameInstance?.loader : '');
  
  if (targetMcVersion) {
    filtered.forEach(v => {
      const matchesMc = (v.game_versions || []).includes(targetMcVersion);
      const matchesLoader = !targetLoader || (v.loaders || []).includes(targetLoader);
      if (matchesMc && matchesLoader) {
        recommendedVersionIds.add(v.id);
      }
    });
  }
  
  list.innerHTML = filtered.slice(0, 30).map(v => {
    const file = v.files?.find(f => f.primary) || v.files?.[0];
    const loaderTags = (v.loaders || []).map(l => `<span class="loader-tag ${l}">${l}</span>`).join('');
    const gameVersions = (v.game_versions || []).slice(0, 3).join(', ');
    const moreVersions = (v.game_versions || []).length > 3 ? ` +${v.game_versions.length - 3}` : '';
    const isRecommended = recommendedVersionIds.has(v.id);
    
    return `
      <div class="mod-version-item ${isRecommended ? 'recommended' : ''}" data-version-id="${v.id}">
        <div class="mod-version-info">
          <div class="mod-version-name">${escapeHtml(v.name || v.version_number)}</div>
          <div class="mod-version-meta">
            ${loaderTags}
            <span class="game-versions">${gameVersions}${moreVersions}</span>
          </div>
        </div>
        <div class="mod-version-actions">
          <span class="mod-version-size">${file ? formatSize(file.size) : '-'}</span>
          <button class="btn-download-version" data-version-id="${v.id}">
            <i class="ri-download-line"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  list.querySelectorAll('.mod-version-item').forEach(item => {
    item.onclick = (e) => {
      if (e.target.closest('.btn-download-version')) return;
      list.querySelectorAll('.mod-version-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      modsState.selectedVersion = modsState.modVersions.find(v => v.id === item.dataset.versionId);
      document.getElementById('mod-detail-download').disabled = false;
    };
  });
  
  list.querySelectorAll('.btn-download-version').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const version = modsState.modVersions.find(v => v.id === btn.dataset.versionId);
      if (version) {
        modsState.selectedVersion = version;
        openDownloadTargetModal();
      }
    };
  });
}

function downloadSelectedModVersion() {
  if (!modsState.selectedVersion) {
    showToast('请先选择一个版本', 'error');
    return;
  }
  openDownloadTargetModal();
}

function openDownloadTargetModal() {
  const modal = document.getElementById('download-target-modal');
  if (!modal) return;
  
  const select = document.getElementById('download-target-version');
  select.innerHTML = '<option value="">选择游戏版本</option>' + 
    installedVersionIds.map(v => `<option value="${v}" ${selectedGameInstance && selectedGameInstance.id === v ? 'selected' : ''}>${v}</option>`).join('');
  
  const file = modsState.selectedVersion?.files?.find(f => f.primary) || modsState.selectedVersion?.files?.[0];
  const filenameEl = document.getElementById('download-target-filename');
  const infoEl = document.getElementById('download-target-info');
  if (file && filenameEl) {
    filenameEl.textContent = file.filename;
    infoEl.style.display = 'block';
  } else {
    infoEl.style.display = 'none';
  }
  
  document.getElementById('download-target-confirm').disabled = !select.value;
  modal.classList.add('show');
}

function closeDownloadTargetModal() {
  document.getElementById('download-target-modal')?.classList.remove('show');
}

async function confirmModDownload() {
  const targetVersion = document.getElementById('download-target-version')?.value;
  if (!targetVersion || !modsState.selectedVersion) {
    showToast('请选择目标版本', 'error');
    return;
  }
  
  const file = modsState.selectedVersion.files?.find(f => f.primary) || modsState.selectedVersion.files?.[0];
  if (!file) {
    showToast('找不到下载文件', 'error');
    return;
  }
  
  const confirmBtn = document.getElementById('download-target-confirm');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="ri-loader-4-line spin"></i><span>下载中...</span>';
  
  try {
    const result = await ipcRenderer.invoke('download-mod', {
      url: file.url,
      filename: file.filename,
      targetVersion: targetVersion,
      hash: file.hashes?.sha1 || file.hashes?.sha512
    });
    
    if (result.success) {
      showToast(`模组 ${file.filename} 下载成功`, 'success');
      closeDownloadTargetModal();
      closeModDetailModal();
    } else {
      throw new Error(result.error || '下载失败');
    }
  } catch (error) {
    console.error('Mod download failed:', error);
    showToast('下载失败: ' + error.message, 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<i class="ri-download-line"></i><span>下载</span>';
  }
}

// 事件监听
function initEventListeners() {
  document.getElementById('back-btn')?.addEventListener('click', () => {
    window.parent.postMessage({ action: 'navigate', page: 'home' }, '*');
  });
  
  // 游戏实例选择
  document.getElementById('game-instance-select')?.addEventListener('change', onGameInstanceChange);
  
  // 搜索
  document.getElementById('mods-search')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchMods();
  });
  document.getElementById('btn-search')?.addEventListener('click', searchMods);
  
  // 筛选器变化时自动刷新
  document.getElementById('mods-game-version')?.addEventListener('change', onFilterChange);
  document.getElementById('mods-loader')?.addEventListener('change', onFilterChange);
  document.getElementById('mods-sort')?.addEventListener('change', onFilterChange);
  
  document.getElementById('refresh-mods')?.addEventListener('click', () => {
    if (modsState.searchQuery) {
      searchMods();
    } else {
      loadRecommendedMods();
    }
  });
  
  // 分页
  document.getElementById('mods-prev')?.addEventListener('click', () => { if (modsState.page > 0) { modsState.page--; searchMods(); } });
  document.getElementById('mods-next')?.addEventListener('click', () => { if (modsState.page < modsState.totalPages - 1) { modsState.page++; searchMods(); } });
  
  // 模组详情弹窗
  document.getElementById('mod-detail-close')?.addEventListener('click', closeModDetailModal);
  document.getElementById('mod-detail-modal')?.addEventListener('click', (e) => { if (e.target.id === 'mod-detail-modal') closeModDetailModal(); });
  document.getElementById('mod-version-game')?.addEventListener('change', filterModVersions);
  document.getElementById('mod-version-loader')?.addEventListener('change', filterModVersions);
  document.getElementById('mod-detail-download')?.addEventListener('click', downloadSelectedModVersion);
  
  // 下载目标选择弹窗
  document.getElementById('download-target-close')?.addEventListener('click', closeDownloadTargetModal);
  document.getElementById('download-target-cancel')?.addEventListener('click', closeDownloadTargetModal);
  document.getElementById('download-target-confirm')?.addEventListener('click', confirmModDownload);
  document.getElementById('download-target-version')?.addEventListener('change', (e) => {
    document.getElementById('download-target-confirm').disabled = !e.target.value;
  });
}

// 工具函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  } catch { return dateStr; }
}

function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function showToast(msg, type = 'info') {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="ri-${type === 'success' ? 'check' : type === 'error' ? 'close' : 'information'}-line"></i><span>${msg}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'toastOut 0.25s ease forwards'; setTimeout(() => toast.remove(), 250); }, 3000);
}
