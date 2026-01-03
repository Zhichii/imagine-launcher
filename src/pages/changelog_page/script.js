// 更新日志页面脚本 - 动态加载版本
document.addEventListener('DOMContentLoaded', async () => {
  await waitForTauriReady();
  initBackButton();
  await loadChangelogFiles();
});

// 等待 Tauri API 就绪
async function waitForTauriReady() {
  let retries = 0;
  while (!window.__TAURI__ && retries < 50) {
    await new Promise(r => setTimeout(r, 100));
    retries++;
  }
}

// 返回按钮
function initBackButton() {
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.parent.postMessage({ action: 'navigate-back' }, '*');
    });
  }
}

// 存储所有版本数据
let changelogData = [];
let selectedVersion = null;

// 加载 changelog 文件
async function loadChangelogFiles() {
  const versionList = document.getElementById('version-list');
  const versionCount = document.getElementById('version-count');
  
  try {
    // 尝试使用 fetch 加载（开发和生产模式都适用）
    await loadChangelogsViaFetch();
    
    // 按版本号排序（降序）
    changelogData.sort((a, b) => compareVersions(b.version, a.version));
    
    // 渲染版本列表
    renderVersionList();
    versionCount.textContent = `${changelogData.length} 个版本`;
    
    // 默认选中第一个版本
    if (changelogData.length > 0) {
      selectVersion(changelogData[0].version);
    }
    
  } catch (error) {
    console.error('Failed to load changelog files:', error);
    versionList.innerHTML = `
      <div class="empty-state">
        <i class="ri-error-warning-line"></i>
        <span>加载失败</span>
      </div>
    `;
  }
}

// 通过 fetch 加载 changelog 文件
async function loadChangelogsViaFetch() {
  // 已知的 changelog 文件列表 - 支持 v0.0.1.txt 和 v0.0.1-alpha.txt 格式
  // 添加新版本时需要更新此列表
  const knownFiles = [
    'v1.0.0-beta.txt',
    'v0.0.1-alpha.txt'
  ];
  
  for (const filename of knownFiles) {
    try {
      const response = await fetch(`file/${filename}`);
      if (response.ok) {
        const content = await response.text();
        const parsed = parseChangelogFile(content, filename);
        if (parsed) {
          changelogData.push(parsed);
        }
      }
    } catch (e) {
      // 文件不存在是正常的，不需要警告
    }
  }
  
  // 如果没有加载到任何文件，尝试使用 Tauri API
  if (changelogData.length === 0 && window.__TAURI__) {
    await loadChangelogsViaTauri();
  }
}

// 通过 Tauri API 加载 changelog 文件
async function loadChangelogsViaTauri() {
  try {
    const { invoke } = window.__TAURI__.core;
    // 如果有后端支持，可以调用 Tauri 命令获取文件列表
    // const files = await invoke('list_changelog_files');
  } catch (e) {
    console.warn('Tauri API not available:', e);
  }
}

// 解析 changelog 文件
function parseChangelogFile(content, filename) {
  const lines = content.split('\n').map(l => l.trim());
  
  // 解析头部信息
  let version = '', channel = '', author = '', date = '';
  let inHeader = false;
  let headerEnd = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('===')) {
      if (!inHeader) {
        inHeader = true;
      } else {
        headerEnd = i + 1;
        break;
      }
      continue;
    }
    
    if (inHeader) {
      if (line.startsWith('update ')) {
        version = line.replace('update ', '').trim();
      } else if (line.startsWith('channel:')) {
        channel = line.replace('channel:', '').trim();
      } else if (line.startsWith('by:')) {
        author = line.replace('by:', '').trim();
      } else if (line.startsWith('data:') || line.startsWith('date:')) {
        date = line.replace(/^(data|date):/, '').trim();
      }
    }
  }
  
  // 如果没有从内容解析到版本号，从文件名获取
  if (!version) {
    // 支持 v0.0.1.txt 和 v0.0.1-alpha.txt 格式
    version = filename.replace('.txt', '');
  }
  
  // 如果没有从内容解析到 channel，尝试从文件名或版本号获取
  if (!channel) {
    const channelMatch = filename.match(/-(alpha|beta|stable|release|rc|snapshot)\.txt$/i);
    if (channelMatch) {
      channel = channelMatch[1].toLowerCase();
    } else {
      // 也检查版本号中是否包含 channel
      const versionChannelMatch = version.match(/-(alpha|beta|stable|release|rc|snapshot)$/i);
      if (versionChannelMatch) {
        channel = versionChannelMatch[1].toLowerCase();
      }
    }
  }
  
  // 解析各个 section
  const sections = {
    bugfix: [],
    optimization: [],
    patch: [],
    addnew: []
  };
  
  let currentSection = null;
  
  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.toLowerCase().startsWith('bug fix:')) {
      currentSection = 'bugfix';
    } else if (line.toLowerCase().startsWith('optimization:')) {
      currentSection = 'optimization';
    } else if (line.toLowerCase().startsWith('patch:')) {
      currentSection = 'patch';
    } else if (line.toLowerCase().startsWith('add new:')) {
      currentSection = 'addnew';
    } else if (currentSection && line.match(/^\d+\./)) {
      const text = line.replace(/^\d+\./, '').trim();
      if (text) {
        sections[currentSection].push(text);
      }
    }
  }
  
  return {
    version,
    channel: channel || 'stable',
    author: author || 'Unknown',
    date: date || '',
    sections
  };
}

// 版本号比较
function compareVersions(a, b) {
  const parseVersion = (v) => {
    const match = v.match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    }
    return [0, 0, 0];
  };
  
  const [a1, a2, a3] = parseVersion(a);
  const [b1, b2, b3] = parseVersion(b);
  
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

// 渲染版本列表
function renderVersionList() {
  const versionList = document.getElementById('version-list');
  
  if (changelogData.length === 0) {
    versionList.innerHTML = `
      <div class="empty-state">
        <i class="ri-file-list-3-line"></i>
        <span>暂无更新日志</span>
      </div>
    `;
    return;
  }
  
  versionList.innerHTML = changelogData.map(item => `
    <div class="version-item" data-version="${item.version}">
      <div class="version-icon ${item.channel}">
        <i class="ri-price-tag-3-line"></i>
      </div>
      <div class="version-info">
        <div class="version-name">${item.version}</div>
        <div class="version-meta">
          <span class="version-date">${item.date || '未知日期'}</span>
          <span class="version-channel ${item.channel}">${getChannelLabel(item.channel)}</span>
        </div>
      </div>
    </div>
  `).join('');
  
  // 绑定点击事件
  versionList.querySelectorAll('.version-item').forEach(item => {
    item.addEventListener('click', () => {
      selectVersion(item.dataset.version);
    });
  });
}

// 获取渠道标签
function getChannelLabel(channel) {
  const labels = {
    alpha: 'Alpha',
    beta: 'Beta',
    stable: 'Stable',
    release: 'Release',
    rc: 'RC',
    snapshot: 'Snapshot'
  };
  return labels[channel.toLowerCase()] || channel;
}

// 选择版本
function selectVersion(version) {
  selectedVersion = version;
  
  // 更新列表选中状态
  document.querySelectorAll('.version-item').forEach(item => {
    item.classList.toggle('active', item.dataset.version === version);
  });
  
  // 渲染详情
  const data = changelogData.find(d => d.version === version);
  if (data) {
    renderDetail(data);
  }
}

// 渲染详情
function renderDetail(data) {
  const container = document.getElementById('detail-container');
  
  const sectionsHtml = [];
  
  // Bug Fix
  if (data.sections.bugfix.length > 0) {
    sectionsHtml.push(renderSection('bugfix', 'Bug 修复', 'ri-bug-line', data.sections.bugfix));
  }
  
  // Optimization
  if (data.sections.optimization.length > 0) {
    sectionsHtml.push(renderSection('optimization', '性能优化', 'ri-speed-line', data.sections.optimization));
  }
  
  // Patch
  if (data.sections.patch.length > 0) {
    sectionsHtml.push(renderSection('patch', '补丁更新', 'ri-tools-line', data.sections.patch));
  }
  
  // Add New
  if (data.sections.addnew.length > 0) {
    sectionsHtml.push(renderSection('addnew', '新增功能', 'ri-add-circle-line', data.sections.addnew));
  }
  
  // 如果没有任何内容
  if (sectionsHtml.length === 0) {
    sectionsHtml.push(`
      <div class="empty-state" style="padding: 40px;">
        <i class="ri-file-text-line"></i>
        <span>此版本暂无详细更新内容</span>
      </div>
    `);
  }
  
  container.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="detail-version">${data.version}</span>
        <span class="detail-channel ${data.channel}">${getChannelLabel(data.channel)}</span>
      </div>
      <div class="detail-meta">
        <span><i class="ri-user-line"></i>${data.author}</span>
        <span><i class="ri-calendar-line"></i>${data.date || '未知日期'}</span>
      </div>
    </div>
    <div class="change-sections">
      ${sectionsHtml.join('')}
    </div>
  `;
  
  // 初始化展开/收起功能
  initSectionToggle();
}

// 渲染单个 section
function renderSection(type, title, icon, items) {
  return `
    <div class="change-section ${type}" data-section="${type}">
      <div class="change-section-header">
        <i class="${icon}"></i>
        <h3>${title}</h3>
        <span class="count">${items.length} 项</span>
        <i class="toggle-icon ri-arrow-down-s-line"></i>
      </div>
      <ul class="change-list">
        ${items.map(item => renderChangeItem(item)).join('')}
      </ul>
    </div>
  `;
}

// 渲染单个变更项（支持标记和加粗）
function renderChangeItem(text) {
  // 解析标记：[NEW] [FIX] [IMPORTANT] [Super Update!] 等
  const badgeRegex = /\[([^\]]+)\]/g;
  const badges = [];
  let processedText = text;
  
  // 提取所有标记
  let match;
  while ((match = badgeRegex.exec(text)) !== null) {
    const badgeText = match[1];
    const badgeType = getBadgeType(badgeText);
    badges.push({ text: badgeText, type: badgeType });
    // 从文本中移除标记
    processedText = processedText.replace(match[0], '').trim();
  }
  
  // 处理加粗：**文本** 或 __文本__
  processedText = processedText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  processedText = processedText.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // 生成 badge HTML
  const badgesHtml = badges.map(b => 
    `<span class="change-badge ${b.type}">${b.text}</span>`
  ).join('');
  
  return `<li>${processedText}${badgesHtml}</li>`;
}

// 获取 badge 类型
function getBadgeType(text) {
  const lower = text.toLowerCase();
  if (lower === 'new' || lower === '新增') return 'new';
  if (lower === 'fix' || lower === '修复') return 'fix';
  if (lower.includes('super') || lower.includes('重大') || lower.includes('重要更新')) return 'super';
  if (lower === 'important' || lower === '重要') return 'important';
  return 'new'; // 默认
}

// 初始化 section 展开/收起
function initSectionToggle() {
  document.querySelectorAll('.change-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.change-section');
      section.classList.toggle('collapsed');
    });
  });
}

// Toast 通知
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="ri-${type === 'success' ? 'checkbox-circle' : type === 'error' ? 'error-warning' : 'information'}-line"></i>
    <span>${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastIn 0.25s ease reverse';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}
