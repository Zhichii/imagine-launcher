// Skins Page Script - 皮肤管理
// 3D 渲染 + 部位标注 + 导出功能

let skinViewer = null;
let currentAccount = null;
let skinImage = null;
let i18nData = {};

// 皮肤部位定义 (64x64 皮肤)
const SKIN_PARTS = {
  head: { x: 8, y: 8, w: 8, h: 8, name: '头部' },
  'head-overlay': { x: 40, y: 8, w: 8, h: 8, name: '头部外层' },
  body: { x: 20, y: 20, w: 8, h: 12, name: '身体' },
  'body-overlay': { x: 20, y: 36, w: 8, h: 12, name: '身体外层' },
  'right-arm': { x: 44, y: 20, w: 4, h: 12, name: '右臂' },
  'right-arm-overlay': { x: 44, y: 36, w: 4, h: 12, name: '右臂外层' },
  'left-arm': { x: 36, y: 52, w: 4, h: 12, name: '左臂' },
  'left-arm-overlay': { x: 52, y: 52, w: 4, h: 12, name: '左臂外层' },
  'right-leg': { x: 4, y: 20, w: 4, h: 12, name: '右腿' },
  'right-leg-overlay': { x: 4, y: 36, w: 4, h: 12, name: '右腿外层' },
  'left-leg': { x: 20, y: 52, w: 4, h: 12, name: '左腿' },
  'left-leg-overlay': { x: 4, y: 52, w: 4, h: 12, name: '左腿外层' }
};

// 初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  let retries = 0;
  while (!window.ipcRenderer && retries < 50) {
    await new Promise(r => setTimeout(r, 50));
    retries++;
  }
  
  if (!window.ipcRenderer) {
    console.error('[Skins] ipcRenderer not available');
    return;
  }
  
  await loadI18n();
  await loadAccount();
  initEventListeners();
  initMessageListener();
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
  } catch (error) {
    console.error('Failed to load i18n:', error);
  }
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
// 账户和皮肤加载
// ═══════════════════════════════════════════════════════════
async function loadAccount() {
  try {
    const result = await ipcRenderer.invoke('get-accounts');
    const accounts = result.accounts || [];
    const currentId = result.current_account;
    
    currentAccount = accounts.find(a => a.id === currentId) || null;
    
    if (currentAccount) {
      updateAccountInfo();
      await loadSkin();
    } else {
      showPlaceholder();
    }
  } catch (error) {
    console.error('Failed to load account:', error);
    showPlaceholder();
  }
}

function updateAccountInfo() {
  document.getElementById('detail-username').textContent = currentAccount.username;
  document.getElementById('detail-uuid').textContent = formatUUID(currentAccount.uuid);
  // 修复：使用 type 而不是 account_type
  const accountType = currentAccount.type || currentAccount.account_type;
  document.getElementById('detail-type').textContent = 
    accountType === 'microsoft' ? 'Microsoft 正版' : '离线账户';
}

function formatUUID(uuid) {
  if (!uuid || uuid.length !== 32) return uuid;
  return `${uuid.slice(0,8)}-${uuid.slice(8,12)}-${uuid.slice(12,16)}-${uuid.slice(16,20)}-${uuid.slice(20)}`;
}

async function loadSkin() {
  const placeholder = document.getElementById('preview-placeholder');
  
  if (!currentAccount) {
    showPlaceholder();
    return;
  }
  
  let skinUrl = currentAccount.skin;
  
  // 如果没有皮肤，使用默认皮肤
  if (!skinUrl) {
    skinUrl = 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb';
  }
  
  // 如果是本地路径，添加 file:// 前缀
  if (skinUrl && !skinUrl.startsWith('http') && !skinUrl.startsWith('file://')) {
    skinUrl = 'file://' + skinUrl;
  }
  
  try {
    placeholder.style.display = 'none';
    
    // 初始化 3D 查看器
    initSkinViewer(skinUrl);
    
    // 加载皮肤图片用于结构展示
    await loadSkinImage(skinUrl);
    
    // 更新信息
    document.getElementById('skin-name').textContent = currentAccount.username;
    document.getElementById('skin-model').textContent = 'Steve 模型';
    
  } catch (error) {
    console.error('Failed to load skin:', error);
    showPlaceholder();
  }
}

function showPlaceholder() {
  document.getElementById('preview-placeholder').style.display = 'flex';
  if (skinViewer) {
    skinViewer.dispose();
    skinViewer = null;
  }
}

// ═══════════════════════════════════════════════════════════
// 3D 皮肤查看器
// ═══════════════════════════════════════════════════════════
function initSkinViewer(skinUrl) {
  const canvas = document.getElementById('skin-canvas');
  
  if (skinViewer) {
    skinViewer.dispose();
  }
  
  skinViewer = new skinview3d.SkinViewer({
    canvas: canvas,
    width: canvas.parentElement.clientWidth,
    height: canvas.parentElement.clientHeight,
    skin: skinUrl
  });
  
  // 设置相机
  skinViewer.camera.position.set(0, 0, 50);
  skinViewer.camera.lookAt(0, 0, 0);
  
  // 默认开启自动旋转
  skinViewer.autoRotate = true;
  skinViewer.autoRotateSpeed = 1;
  
  // 设置光照
  skinViewer.globalLight.intensity = 0.8;
  skinViewer.cameraLight.intensity = 0.5;
  
  // 更新按钮状态
  document.getElementById('rotate-btn').classList.add('active');
  
  // 响应窗口大小变化
  const resizeObserver = new ResizeObserver(() => {
    if (skinViewer) {
      skinViewer.width = canvas.parentElement.clientWidth;
      skinViewer.height = canvas.parentElement.clientHeight;
    }
  });
  resizeObserver.observe(canvas.parentElement);
}

// ═══════════════════════════════════════════════════════════
// 皮肤图片处理
// ═══════════════════════════════════════════════════════════
async function loadSkinImage(skinUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      skinImage = img;
      renderSkinMap();
      renderPartPreviews();
      resolve();
    };
    
    img.onerror = (e) => {
      console.error('Failed to load skin image:', e);
      reject(e);
    };
    
    img.src = skinUrl;
  });
}

function renderSkinMap() {
  if (!skinImage) return;
  
  const canvas = document.getElementById('skin-map-canvas');
  const ctx = canvas.getContext('2d');
  
  // 清除画布
  ctx.clearRect(0, 0, 64, 64);
  
  // 绘制皮肤
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(skinImage, 0, 0, 64, 64);
}

function renderPartPreviews() {
  if (!skinImage) return;
  
  // 为每个部位创建预览
  const parts = ['head', 'body', 'right-arm', 'left-arm', 'right-leg', 'left-leg'];
  
  parts.forEach(partId => {
    const container = document.getElementById(`part-${partId}`);
    if (!container) return;
    
    const part = SKIN_PARTS[partId];
    if (!part) return;
    
    // 创建 canvas
    let canvas = container.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = part.w;
      canvas.height = part.h;
      container.appendChild(canvas);
    }
    
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, part.w, part.h);
    
    // 绘制部位
    ctx.drawImage(
      skinImage,
      part.x, part.y, part.w, part.h,
      0, 0, part.w, part.h
    );
  });
}

// ═══════════════════════════════════════════════════════════
// 导出功能
// ═══════════════════════════════════════════════════════════
async function exportSkin() {
  if (!skinImage) {
    showToast('没有可导出的皮肤', 'error');
    return;
  }
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = skinImage.width;
    canvas.height = skinImage.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(skinImage, 0, 0);
    
    // 转换为 blob 并下载
    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('导出失败', 'error');
        return;
      }
      
      // 创建下载链接
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentAccount?.username || 'skin'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('皮肤已导出', 'success');
    }, 'image/png');
  } catch (error) {
    console.error('Export failed:', error);
    showToast('导出失败', 'error');
  }
}

async function exportPart(partId) {
  if (!skinImage) {
    showToast('没有可导出的皮肤', 'error');
    return;
  }
  
  const part = SKIN_PARTS[partId];
  if (!part) return;
  
  try {
    const canvas = document.createElement('canvas');
    // 放大 8 倍以便查看
    const scale = 8;
    canvas.width = part.w * scale;
    canvas.height = part.h * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      skinImage,
      part.x, part.y, part.w, part.h,
      0, 0, part.w * scale, part.h * scale
    );
    
    // 转换为 blob 并下载
    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('导出失败', 'error');
        return;
      }
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentAccount?.username || 'skin'}_${partId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast(`${part.name} 已导出`, 'success');
    }, 'image/png');
  } catch (error) {
    console.error('Export part failed:', error);
    showToast('导出失败', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// 更换皮肤
// ═══════════════════════════════════════════════════════════
async function changeSkin() {
  if (!currentAccount) {
    showToast('请先登录账户', 'error');
    return;
  }
  
  // 修复：使用 type 而不是 account_type
  const accountType = currentAccount.type || currentAccount.account_type;
  if (accountType === 'microsoft') {
    showToast('微软账户请在官网更换皮肤', 'error');
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('select-skin-file');
    
    if (result.success && result.path) {
      const setResult = await ipcRenderer.invoke('set-offline-skin', currentAccount.id, result.path);
      
      if (setResult.success) {
        showToast('皮肤已更换', 'success');
        await loadAccount();
      } else {
        showToast(setResult.error || '更换失败', 'error');
      }
    }
  } catch (error) {
    console.error('Change skin failed:', error);
    showToast('更换失败', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// 事件监听
// ═══════════════════════════════════════════════════════════
function initEventListeners() {
  // 返回按钮
  document.getElementById('back-btn').onclick = () => {
    window.parent.postMessage({ action: 'navigate', page: 'home' }, '*');
  };
  
  // 旋转控制
  document.getElementById('rotate-btn').onclick = (e) => {
    if (!skinViewer) return;
    skinViewer.autoRotate = !skinViewer.autoRotate;
    e.currentTarget.classList.toggle('active', skinViewer.autoRotate);
  };
  
  // 行走动画
  document.getElementById('walk-btn').onclick = (e) => {
    if (!skinViewer) return;
    const isActive = e.currentTarget.classList.toggle('active');
    
    if (isActive) {
      document.getElementById('run-btn').classList.remove('active');
      skinViewer.animation = new skinview3d.WalkingAnimation();
      skinViewer.animation.speed = 0.8;
    } else {
      skinViewer.animation = null;
    }
  };
  
  // 奔跑动画
  document.getElementById('run-btn').onclick = (e) => {
    if (!skinViewer) return;
    const isActive = e.currentTarget.classList.toggle('active');
    
    if (isActive) {
      document.getElementById('walk-btn').classList.remove('active');
      skinViewer.animation = new skinview3d.RunningAnimation();
      skinViewer.animation.speed = 1.2;
    } else {
      skinViewer.animation = null;
    }
  };
  
  // 更换皮肤
  document.getElementById('change-skin-btn').onclick = changeSkin;
  
  // 重置皮肤
  document.getElementById('reset-skin-btn').onclick = async () => {
    if (!currentAccount || currentAccount.account_type === 'microsoft') {
      showToast('无法重置', 'error');
      return;
    }
    // TODO: 实现重置功能
    showToast('功能开发中', 'info');
  };
  
  // 导出皮肤
  document.getElementById('export-skin-btn').onclick = exportSkin;
  
  // 部位导出
  document.querySelectorAll('.part-export').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const partId = btn.closest('.part-item').dataset.part;
      exportPart(partId);
    };
  });
  
  // 部位点击
  document.querySelectorAll('.part-item').forEach(item => {
    item.onclick = () => {
      const partId = item.dataset.part;
      highlightPart(partId);
    };
  });
  
  // 皮肤地图部位点击
  document.querySelectorAll('.part-label').forEach(label => {
    label.onclick = () => {
      const partId = label.dataset.part;
      exportPart(partId);
    };
  });
}

function highlightPart(partId) {
  // 高亮选中的部位
  document.querySelectorAll('.part-item').forEach(item => {
    item.classList.toggle('active', item.dataset.part === partId);
  });
  
  // TODO: 在 3D 视图中高亮对应部位
}

function initMessageListener() {
  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'reload-i18n') {
      await loadI18n();
    } else if (event.data?.action === 'config-updated' && event.data.config) {
      applyTheme(event.data.config.theme);
    } else if (event.data?.action === 'account-updated') {
      await loadAccount();
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
  if (accentColor) {
    root.style.setProperty('--accent', accentColor);
    root.style.setProperty('--accent-soft', hexToRgba(accentColor, 0.12));
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
