const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let appConfig = {};
let i18nData = {};

// 初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  console.log('ImagineLauncher initializing...');
  initWindowControls();
  initNavigation();
  initInteractions();
  initUserPill();
  loadConfig();
  initIframeMessaging();
}

// iframe 消息
function initIframeMessaging() {
  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'back-to-home') {
      showPage('home');
      setActiveNav('home');
    } else if (event.data?.action === 'avatar-updated') {
      // 头像更新，重新加载账户数据
      const result = await ipcRenderer.invoke('get-accounts');
      if (result) {
        await updateUserDisplay(result);
      }
    }
  });
  
  // 监听授权码对话框请求
  ipcRenderer.on('show-auth-code-dialog', (event, { state }) => {
    console.log('主窗口收到显示对话框消息, state:', state);
    showAuthCodeDialog(state);
  });
}

// 显示授权码输入对话框
function showAuthCodeDialog(state) {
  console.log('显示授权码对话框');
  
  // 创建对话框
  const overlay = document.createElement('div');
  overlay.className = 'auth-dialog-overlay';
  overlay.innerHTML = `
    <div class="auth-dialog">
      <div class="auth-dialog-header">
        <h3>输入授权码</h3>
        <button class="auth-dialog-close"><i class="ri-close-line"></i></button>
      </div>
      <div class="auth-dialog-body">
        <div class="auth-dialog-message">
          <p><strong>步骤：</strong></p>
          <p>1. 浏览器已打开微软登录页面</p>
          <p>2. 登录后会跳转到一个空白页面</p>
          <p>3. <strong>复制整个地址栏的 URL</strong></p>
          <p>4. 粘贴到下方输入框并点击确定</p>
        </div>
        <div class="auth-dialog-input-group">
          <label>粘贴完整 URL 或授权码</label>
          <textarea id="auth-code-input" placeholder="粘贴整个 URL 或授权码..." rows="4"></textarea>
          <span class="auth-input-hint">可以粘贴整个 URL，系统会自动提取授权码</span>
        </div>
      </div>
      <div class="auth-dialog-footer">
        <button class="auth-dialog-btn secondary" data-action="cancel">取消</button>
        <button class="auth-dialog-btn primary" data-action="confirm">确定</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // 动画显示
  requestAnimationFrame(() => overlay.classList.add('show'));
  
  const input = overlay.querySelector('#auth-code-input');
  input?.focus();
  
  // 关闭对话框
  const closeDialog = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };
  
  // 从 URL 或文本中提取授权码
  const extractCode = (text) => {
    if (!text) return null;
    text = text.trim();
    
    // 如果包含 code= 参数，提取它
    const codeMatch = text.match(/[?&]code=([^&\s]+)/);
    if (codeMatch) {
      return decodeURIComponent(codeMatch[1]);
    }
    
    // 如果看起来像是纯授权码（M.开头的长字符串）
    if (text.startsWith('M.') || text.length > 100) {
      return text;
    }
    
    return text;
  };
  
  // 关闭按钮
  overlay.querySelector('.auth-dialog-close')?.addEventListener('click', () => {
    closeDialog();
    ipcRenderer.invoke('submit-auth-code', { code: null, inputState: state });
  });
  
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeDialog();
      ipcRenderer.invoke('submit-auth-code', { code: null, inputState: state });
    }
  });
  
  // 确定按钮
  overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
    const rawInput = input?.value?.trim();
    if (!rawInput) {
      input?.focus();
      return;
    }
    
    const code = extractCode(rawInput);
    console.log('提取的授权码:', code?.substring(0, 50) + '...');
    
    closeDialog();
    console.log('提交授权码, state:', state);
    
    // 提交授权码
    await ipcRenderer.invoke('submit-auth-code', { code, inputState: state });
  });
  
  // 取消按钮
  overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    closeDialog();
    ipcRenderer.invoke('submit-auth-code', { code: null, inputState: state });
  });
}

// 用户pill点击 - 跳转账户页面
function initUserPill() {
  const userPill = document.querySelector('.user-pill');
  userPill?.addEventListener('click', () => {
    showPage('account');
    // 账户页面不在侧边栏，清除所有nav active状态
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    // 更新标题
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
      pageTitle.textContent = getI18n('account.title') || '账户';
      pageTitle.setAttribute('data-i18n', 'account.title');
    }
    // 隐藏搜索框
    const titlebarCenter = document.querySelector('.titlebar-center');
    if (titlebarCenter) titlebarCenter.classList.add('hidden');
  });
}

// 窗口控制
function initWindowControls() {
  const minimizeBtn = document.getElementById('minimize');
  const maximizeBtn = document.getElementById('maximize');
  const closeBtn = document.getElementById('close');

  minimizeBtn?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
  maximizeBtn?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
  closeBtn?.addEventListener('click', () => ipcRenderer.send('window-close'));

  ipcRenderer.on('window-maximized', () => {
    if (maximizeBtn) {
      maximizeBtn.querySelector('i').className = 'ri-checkbox-multiple-blank-line';
    }
  });

  ipcRenderer.on('window-unmaximized', () => {
    if (maximizeBtn) {
      maximizeBtn.querySelector('i').className = 'ri-checkbox-blank-line';
    }
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
  
  // 更新页面标题
  const pageTitle = document.querySelector('.page-title');
  const activeBtn = document.querySelector(`.nav-btn[data-page="${pageName}"] span`);
  if (pageTitle && activeBtn) {
    pageTitle.textContent = activeBtn.textContent;
    pageTitle.setAttribute('data-i18n', activeBtn.getAttribute('data-i18n'));
  }
  
  // 控制搜索框显示 - 只在实例、模组等页面显示
  const titlebarCenter = document.querySelector('.titlebar-center');
  if (titlebarCenter) {
    const showSearch = ['instances', 'mods', 'resourcepacks', 'downloads'].includes(pageName);
    titlebarCenter.classList.toggle('hidden', !showSearch);
  }
}

function showPage(pageName) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === `${pageName}-page`);
  });
}

// 交互
function initInteractions() {
  // 启动按钮
  document.querySelector('.btn-launch')?.addEventListener('click', () => {
    showToast(getI18n('notification.launching') || '正在启动游戏...', 'success');
  });

  // 快捷卡片
  document.querySelectorAll('.quick-card').forEach(card => {
    card.addEventListener('click', () => {
      const title = card.querySelector('.quick-title')?.textContent;
      console.log('Quick action:', title);
    });
  });

  // 实例播放
  document.querySelectorAll('.btn-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.closest('.instance-item')?.querySelector('.instance-name')?.textContent;
      showToast(`${getI18n('notification.launchingInstance') || '正在启动'} ${name}...`, 'success');
    });
  });

  // 实例点击
  document.querySelectorAll('.instance-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.querySelector('.instance-name')?.textContent;
      console.log('Instance clicked:', name);
    });
  });
}

// 配置
async function loadConfig() {
  try {
    appConfig = await ipcRenderer.invoke('get-config');
    applyConfig();
    await loadI18n(appConfig.app?.language || 'zh-CN');
  } catch (error) {
    console.error('Failed to load config:', error);
    // 尝试加载默认语言
    await loadI18n('zh-CN');
  }
}

function applyConfig() {
  const root = document.documentElement;
  
  if (appConfig.window?.borderRadius) {
    document.body.classList.add('rounded-window');
  } else {
    document.body.classList.remove('rounded-window');
  }
  
  // 应用自定义主题色
  if (appConfig.theme) {
    const theme = appConfig.theme;
    if (theme.accentColor) {
      root.style.setProperty('--accent', theme.accentColor);
      root.style.setProperty('--accent-soft', hexToRgba(theme.accentColor, 0.12));
      root.style.setProperty('--accent-glow', hexToRgba(theme.accentColor, 0.25));
    }
    if (theme.gradientColors && theme.gradientColors.length > 0) {
      const gradient = theme.gradientColors.join(', ');
      root.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${gradient})`);
      root.style.setProperty('--gradient-start', theme.gradientColors[0]);
      root.style.setProperty('--gradient-end', theme.gradientColors[theme.gradientColors.length - 1]);
      document.body.classList.add('custom-gradient');
    } else {
      document.body.classList.remove('custom-gradient');
    }
  }
  
  document.title = 'ImagineLauncher';
}

// 颜色转换辅助函数
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// i18n
async function loadI18n(language) {
  try {
    const i18nPath = path.join(__dirname, 'locales', `${language}.json`);
    const data = fs.readFileSync(i18nPath, 'utf8');
    i18nData = JSON.parse(data);
    applyI18n();
  } catch (error) {
    console.error('Failed to load i18n:', error);
  }
}

function applyI18n() {
  // 文本内容
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = getI18n(key);
    if (value) el.textContent = value;
  });
  
  // placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const value = getI18n(key);
    if (value) el.placeholder = value;
  });
}

function getI18n(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], i18nData);
}

// 监听配置更新
ipcRenderer.on('config-loaded', (event, config) => {
  appConfig = config;
  applyConfig();
  loadI18n(config.app?.language || 'zh-CN');
});

// 监听账户数据
ipcRenderer.on('accounts-loaded', (event, data) => {
  // 更新 titlebar 用户显示
  updateUserDisplay(data);
});

async function updateUserDisplay(data) {
  const userPill = document.querySelector('.user-pill');
  const userName = document.querySelector('.user-name');
  const userAvatar = document.querySelector('.user-avatar');
  
  if (data.currentAccount && data.accounts) {
    const account = data.accounts.find(a => a.id === data.currentAccount);
    if (account) {
      // 更新用户名
      if (userName) {
        userName.textContent = account.username;
      }
      
      // 更新头像
      if (userAvatar) {
        try {
          const result = await ipcRenderer.invoke('get-account-avatar', account.id);
          if (result.success && result.avatarPath) {
            // 清空原有内容
            userAvatar.innerHTML = '';
            
            // 创建图片元素
            const img = document.createElement('img');
            img.src = `file://${result.avatarPath}?t=${Date.now()}`; // 添加时间戳防止缓存
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.imageRendering = 'pixelated'; // Minecraft 像素风格
            img.style.borderRadius = '50%';
            userAvatar.appendChild(img);
          } else {
            // 使用默认图标
            userAvatar.innerHTML = '<i class="ri-user-line"></i>';
          }
        } catch (error) {
          console.error('Failed to load avatar:', error);
          userAvatar.innerHTML = '<i class="ri-user-line"></i>';
        }
      }
    }
  } else {
    // 未登录状态
    if (userName) {
      userName.textContent = getI18n('user.player') || '玩家';
    }
    if (userAvatar) {
      userAvatar.innerHTML = '<i class="ri-user-line"></i>';
    }
  }
}

// Toast 通知
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
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}
