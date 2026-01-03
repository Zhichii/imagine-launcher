// 等待 Tauri API 加载
let invoke, listen, emit;

async function initTauriAPI() {
  // Tauri 2.0 使用 @tauri-apps/api，通过 window.__TAURI__ 暴露
  if (window.__TAURI__) {
    invoke = window.__TAURI__.core.invoke;
    listen = window.__TAURI__.event.listen;
    emit = window.__TAURI__.event.emit;
    return true;
  }
  return false;
}

let appConfig = {};
let i18nData = {};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  console.log('ImagineLauncher (Tauri) initializing...');
  
  // 加载版本信息
  await window.VersionLoader.load();
  console.log('[Main] Version loaded:', window.VersionLoader.getFullVersion());
  
  // 等待 Tauri API - 增加等待时间和重试次数
  let retries = 0;
  const maxRetries = 100; // 最多等待 10 秒
  while (!await initTauriAPI() && retries < maxRetries) {
    await new Promise(r => setTimeout(r, 100));
    retries++;
  }
  
  if (!invoke) {
    console.error('Tauri API not available after', retries * 100, 'ms');
    // 尝试使用备用方式
    if (window.__TAURI_INTERNALS__) {
      console.log('Found __TAURI_INTERNALS__, trying alternative approach');
    }
    return;
  }
  
  console.log('Tauri API loaded after', retries * 100, 'ms');
  
  initWindowControls();
  initNavigation();
  initInteractions();
  initUserPill();
  await loadConfig();
  initEventListeners();
});

// Tauri 事件监听
async function initEventListeners() {
  if (!listen) return;
  
  await listen('accounts-loaded', async (event) => {
    await updateUserDisplay(event.payload);
  });
  
  await listen('show-manual-auth-dialog', (event) => {
    console.log('[Main] Received show-manual-auth-dialog event', event.payload);
    // 通知账户页面显示手动输入对话框，传递 authUrl
    const accountIframe = document.querySelector('#account-page iframe');
    if (accountIframe?.contentWindow) {
      accountIframe.contentWindow.postMessage({ 
        action: 'show-manual-auth-dialog',
        authUrl: event.payload?.authUrl 
      }, '*');
    }
  });
  
  await listen('launch-step', (event) => {
    const iframe = document.querySelector('.page.active iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        action: 'launch-step',
        ...event.payload
      }, '*');
    }
  });
  
  // 监听所有游戏退出事件
  await listen('all-games-exited', (event) => {
    console.log('[Main] All games exited, window should be restored by backend');
    // 通知 iframe 刷新状态
    const iframe = document.querySelector('.page.active iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ action: 'all-games-exited' }, '*');
    }
  });
  
  // 监听单个实例退出事件
  await listen('instance-exited', (event) => {
    console.log('[Main] Instance exited:', event.payload);
    const iframe = document.querySelector('.page.active iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        action: 'instance-exited',
        ...event.payload
      }, '*');
    }
  });
  
  // 监听游戏退出事件（包含崩溃信息）
  await listen('game-exited', (event) => {
    console.log('[Main] Game exited:', event.payload);
    
    // 崩溃报告由后端独立窗口处理，这里只转发事件更新实例状态
    
    // 转发到所有 iframe（更新实例状态）
    document.querySelectorAll('iframe').forEach(iframe => {
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({
          action: 'game-exited',
          ...event.payload
        }, '*');
      }
    });
  });
  
  // 监听配置更新事件（来自设置页面）
  await listen('config-updated', async (event) => {
    console.log('[Main] Config updated:', event.payload);
    // 重新加载配置并应用
    try {
      appConfig = await invoke('get_config');
      applyConfig();
      console.log('[Main] Config reapplied after update');
    } catch (error) {
      console.error('[Main] Failed to reload config:', error);
    }
  });
  
  // 监听语言变更事件
  await listen('language-changed', async (event) => {
    console.log('[Main] Language changed:', event.payload);
    const newLanguage = event.payload?.language;
    if (newLanguage) {
      await loadI18n(newLanguage);
      refreshAllIframes();
    }
  });
  
  // 监听 deep link 认证成功事件
  await listen('auth-success', async (event) => {
    console.log('[Main] Auth success:', event.payload);
    // 更新用户显示
    const accountsData = await invoke('get_accounts');
    if (accountsData) {
      await updateUserDisplay(accountsData);
    }
    // 通知账户页面刷新
    const accountIframe = document.querySelector('#account-page iframe');
    if (accountIframe?.contentWindow) {
      accountIframe.contentWindow.postMessage({ action: 'auth-success', data: event.payload }, '*');
    }
    showToast('登录成功！', 'success');
  });
  
  // 监听认证错误事件
  await listen('auth-error', (event) => {
    console.log('[Main] Auth error:', event.payload);
    showToast('登录失败: ' + event.payload, 'error');
  });
}

// iframe 消息处理
window.addEventListener('message', async (event) => {
  if (!invoke) return;
  
  if (event.data?.action === 'back-to-home') {
    showPage('home');
    setActiveNav('home');
  } else if (event.data?.action === 'navigate') {
    // 处理页面导航请求
    const page = event.data.page;
    if (page) {
      showPage(page);
      setActiveNav(page);
    }
  } else if (event.data?.action === 'avatar-updated') {
    // 更新 titlebar 用户显示
    const result = await invoke('get_accounts');
    if (result) {
      await updateUserDisplay(result);
    }
    // 通知首页 iframe 更新账户显示
    const homeIframe = document.querySelector('#home-page iframe');
    if (homeIframe?.contentWindow) {
      homeIframe.contentWindow.postMessage({ action: 'avatar-updated' }, '*');
    }
  } else if (event.data?.action === 'hide-sidebar') {
    document.querySelector('.sidebar')?.classList.add('hidden');
    document.querySelector('.main-area')?.classList.add('full-width');
  } else if (event.data?.action === 'show-sidebar') {
    document.querySelector('.sidebar')?.classList.remove('hidden');
    document.querySelector('.main-area')?.classList.remove('full-width');
  } else if (event.data?.action === 'config-updated') {
    console.log('[Main] Config updated from iframe:', event.data.config);
    // 直接使用传来的配置应用主题
    if (event.data.config) {
      appConfig = event.data.config;
      applyConfig();
      // 通知其他 iframe 更新主题
      notifyIframesConfigUpdate(event.data.config);
      console.log('[Main] Theme applied from iframe message');
    }
  } else if (event.data?.action === 'language-changed') {
    console.log('[Main] Language changed from iframe:', event.data.language);
    // 重新加载语言并刷新所有 iframe
    if (event.data.language) {
      await loadI18n(event.data.language);
      refreshAllIframes();
    }
  } else if (event.data?.action === 'theme-transition-start') {
    // 主题切换动画开始
    document.documentElement.classList.add('theme-transitioning');
  } else if (event.data?.action === 'theme-transition-end') {
    // 主题切换动画结束
    document.documentElement.classList.remove('theme-transitioning');
  }
});


// 用户pill点击
function initUserPill() {
  const userPill = document.querySelector('.user-pill');
  userPill?.addEventListener('click', () => {
    showPage('account');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
      pageTitle.textContent = getI18n('account.title') || '账户';
    }
    document.querySelector('.titlebar-center')?.classList.add('hidden');
  });
}

// 窗口控制
function initWindowControls() {
  document.getElementById('minimize')?.addEventListener('click', () => {
    invoke('window_minimize');
  });
  document.getElementById('maximize')?.addEventListener('click', () => {
    invoke('window_maximize');
  });
  document.getElementById('close')?.addEventListener('click', () => {
    invoke('window_close');
  });
}

// 导航
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) {
        showPage(page);
        setActiveNav(page);
      }
    });
  });
}

function setActiveNav(pageName) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageName);
  });
  
  const pageTitle = document.querySelector('.page-title');
  const activeBtn = document.querySelector(`.nav-btn[data-page="${pageName}"] span`);
  if (pageTitle && activeBtn) {
    pageTitle.textContent = activeBtn.textContent;
  }
  
  const titlebarCenter = document.querySelector('.titlebar-center');
  if (titlebarCenter) {
    const showSearch = ['instances', 'mods', 'resourcepacks', 'downloads'].includes(pageName);
    titlebarCenter.classList.toggle('hidden', !showSearch);
  }
}

// 页面切换防抖
let isTransitioning = false;

function showPage(pageName) {
  // 防止快速切换导致重叠
  if (isTransitioning) return;
  
  const currentPage = document.querySelector('.page.active');
  const nextPage = document.getElementById(`${pageName}-page`);
  
  if (!nextPage || currentPage === nextPage) return;
  
  isTransitioning = true;
  
  // 获取当前页面和目标页面的索引（用于判断滑动方向）
  const pages = Array.from(document.querySelectorAll('.page'));
  const currentIndex = currentPage ? pages.indexOf(currentPage) : -1;
  const nextIndex = pages.indexOf(nextPage);
  
  // 判断滑动方向
  const direction = nextIndex > currentIndex ? 'left' : 'right';
  
  // 设置过渡动画
  if (currentPage) {
    currentPage.style.animation = `slideOut${direction === 'left' ? 'Left' : 'Right'} 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards`;
  }
  
  nextPage.classList.add('active');
  nextPage.style.animation = `slideIn${direction === 'left' ? 'Right' : 'Left'} 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards`;
  
  // 清理动画
  setTimeout(() => {
    if (currentPage) {
      currentPage.classList.remove('active');
      currentPage.style.animation = '';
    }
    nextPage.style.animation = '';
    isTransitioning = false;
  }, 300);
}

// 交互
function initInteractions() {
  document.querySelector('.btn-launch')?.addEventListener('click', () => {
    showToast(getI18n('notification.launching') || '正在启动游戏...', 'success');
  });

  document.querySelectorAll('.quick-card').forEach(card => {
    card.addEventListener('click', () => {
      console.log('Quick action clicked');
    });
  });

  document.querySelectorAll('.btn-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.closest('.instance-item')?.querySelector('.instance-name')?.textContent;
      showToast(`正在启动 ${name}...`, 'success');
    });
  });
}


// 配置
async function loadConfig() {
  try {
    appConfig = await invoke('get_config');
    applyConfig();
    await loadI18n(appConfig.app?.language || 'zh-CN');
    
    const accountsData = await invoke('get_accounts');
    if (accountsData) {
      await updateUserDisplay(accountsData);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
    await loadI18n('zh-CN');
  }
}

function applyConfig() {
  console.log('[Main] applyConfig called with:', appConfig);
  const root = document.documentElement;
  
  if (appConfig.window?.border_radius || appConfig.window?.borderRadius) {
    document.body.classList.add('rounded-window');
  }
  
  if (appConfig.theme) {
    const theme = appConfig.theme;
    console.log('[Main] Applying theme:', theme);
    
    // 获取强调色和渐变色
    const accentColor = theme.accent_color || theme.accentColor;
    const gradientColors = theme.gradient_colors || theme.gradientColors;
    
    console.log('[Main] Accent color:', accentColor);
    console.log('[Main] Gradient colors:', gradientColors);
    
    // 应用强调色
    if (accentColor) {
      root.style.setProperty('--accent', accentColor);
      root.style.setProperty('--accent-soft', hexToRgba(accentColor, 0.12));
      root.style.setProperty('--accent-glow', hexToRgba(accentColor, 0.25));
    }
    
    // 应用渐变色
    if (gradientColors?.length > 0) {
      const gradient = gradientColors.join(', ');
      root.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${gradient})`);
      root.style.setProperty('--gradient-start', gradientColors[0]);
      root.style.setProperty('--gradient-end', gradientColors[gradientColors.length - 1]);
    }
  }
  
  document.title = 'ImagineLauncher';
  
  // 更新标题显示版本号（可选）
  const logoText = document.querySelector('.logo-text');
  if (logoText && window.VersionLoader) {
    // logoText.textContent = `ImagineLauncher ${window.VersionLoader.getVersion()}`;
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// i18n
async function loadI18n(language) {
  try {
    const response = await fetch(`locales/${language}.json`);
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
  return key.split('.').reduce((obj, k) => obj?.[k], i18nData);
}

async function updateUserDisplay(data) {
  const userName = document.querySelector('.user-name');
  const userAvatar = document.querySelector('.user-avatar');
  
  const currentAccount = data.current_account || data.currentAccount;
  const accounts = data.accounts;
  
  if (currentAccount && accounts) {
    const account = accounts.find(a => a.id === currentAccount);
    if (account) {
      if (userName) userName.textContent = account.username;
      
      if (userAvatar) {
        // 使用后端生成的头像（包含帽子层）
        try {
          const avatarResult = await invoke('get_account_avatar', { accountId: account.id });
          console.log('[Main] Avatar result:', avatarResult);
          
          if (avatarResult.success && avatarResult.avatarPath) {
            const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
            const avatarUrl = convertFileSrc ? convertFileSrc(avatarResult.avatarPath) : `file://${avatarResult.avatarPath}`;
            // 添加时间戳防止缓存
            userAvatar.innerHTML = `<img src="${avatarUrl}?t=${Date.now()}" style="width:100%;height:100%;border-radius:50%;image-rendering:pixelated;">`;
          } else {
            userAvatar.innerHTML = '<i class="ri-user-line"></i>';
          }
        } catch (e) {
          console.error('[Main] Failed to get avatar:', e);
          userAvatar.innerHTML = '<i class="ri-user-line"></i>';
        }
      }
    }
  } else {
    if (userName) userName.textContent = getI18n('user.player') || '玩家';
    if (userAvatar) userAvatar.innerHTML = '<i class="ri-user-line"></i>';
  }
}

// 从皮肤图片提取头像（2D，脸部+帽子层叠加）
async function extractAvatarFromSkin(skinUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        console.log('[Avatar] Skin loaded, size:', img.width, 'x', img.height);
        
        // 输出尺寸（放大到 64x64）
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        
        // 第一层：绘制脸部正面 (8x8 从坐标 8,8 开始)
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
        
        // 第二层：绘制帽子层正面
        // 新版皮肤(64x64)和旧版皮肤(64x32)的帽子层都在 40,8
        ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
        
        console.log('[Avatar] Avatar created with face + hat layer');
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        console.error('Failed to extract avatar:', e);
        resolve(null);
      }
    };
    img.onerror = (e) => {
      console.error('[Avatar] Failed to load skin image:', e);
      resolve(null);
    };
    img.src = skinUrl;
  });
}

// Toast
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="${type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}"></i><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// 导出给 iframe 使用
window.tauriInvoke = (...args) => invoke?.(...args);
window.showToast = showToast;
window.getI18n = getI18n;

// 刷新所有 iframe
async function refreshAllIframes() {
  document.querySelectorAll('iframe').forEach(iframe => {
    try {
      // 通知 iframe 重新加载语言
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ action: 'reload-i18n' }, '*');
      }
    } catch (e) {
      console.error('[Main] Failed to notify iframe:', e);
    }
  });
  
  // 重新获取账户数据并更新 titlebar 显示
  try {
    const accountsData = await invoke('get_accounts');
    if (accountsData) {
      await updateUserDisplay(accountsData);
    }
  } catch (e) {
    console.error('[Main] Failed to refresh user display:', e);
  }
}

// 通知所有 iframe 更新主题
function notifyIframesConfigUpdate(config) {
  document.querySelectorAll('iframe').forEach(iframe => {
    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ action: 'config-updated', config }, '*');
      }
    } catch (e) {
      console.error('[Main] Failed to notify iframe config update:', e);
    }
  });
}
