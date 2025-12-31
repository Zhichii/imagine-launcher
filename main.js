const { app, BrowserWindow, ipcMain, Menu, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// 加载环境变量
require('dotenv').config();

// 尝试加载 sharp，如果失败则使用备用方案
let Sharp;
try {
  Sharp = require('sharp');
  console.log('Sharp image processing library loaded successfully');
} catch (error) {
  console.warn('Sharp module not available, avatar extraction will be limited');
  Sharp = null;
}

let mainWindow;
let config;
let accounts = [];
let currentAccount = null;
let authCallbackResolver = null; // 授权回调处理器

// Azure AD 应用配置
// 
// 使用 Minecraft 官方 Client ID（已预配置所有权限）
// 如果想使用自己的 Client ID，需要联系 Microsoft 获取 Minecraft Services API 访问权限
// 
// 配置方式：
// 1. 复制 .env.example 为 .env
// 2. 在 .env 中填入你的配置（如果使用自定义 Client ID）
//
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '00000000402b5328'; // Minecraft 官方 Client ID
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://login.live.com/oauth20_desktop.srf';
const CUSTOM_PROTOCOL = process.env.CUSTOM_PROTOCOL || 'ms-xal-00000000402b5328'; // 官方协议

// 数据目录
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SKINS_DIR = path.join(DATA_DIR, 'skins');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

// 确保数据目录存在
function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SKINS_DIR)) {
    fs.mkdirSync(SKINS_DIR, { recursive: true });
  }
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
}

// 加载配置文件
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configData);
    return config;
  } catch (error) {
    console.error('Failed to load config:', error);
    return {
      app: { name: 'ImagineLauncher', version: '0.0.1', language: 'zh-CN' },
      window: { width: 1000, height: 600, minWidth: 800, minHeight: 500, borderRadius: true, radiusSize: 12 },
      ui: { scrollbar: false, titlebarHeight: 48, animations: true }
    };
  }
}

// 加载账户数据
function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      accounts = parsed.accounts || [];
      currentAccount = parsed.currentAccount || null;
    }
  } catch (error) {
    console.error('Failed to load accounts:', error);
    accounts = [];
    currentAccount = null;
  }
}

// 保存账户数据
function saveAccounts() {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({
      accounts,
      currentAccount
    }, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save accounts:', error);
    return false;
  }
}

function createWindow() {
  ensureDataDirs();
  config = loadConfig();
  loadAccounts();

  mainWindow = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    minWidth: config.window.minWidth,
    minHeight: config.window.minHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true
    }
  });

  mainWindow.loadFile('index.html');
  createMenu();

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('config-loaded', config);
    mainWindow.webContents.send('accounts-loaded', { accounts, currentAccount });
  });
}

// 创建菜单
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: () => {} }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ═══════════════════════════════════════════════════════════
// 窗口控制 IPC
// ═══════════════════════════════════════════════════════════
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());

app.on('browser-window-created', (_, window) => {
  window.on('maximize', () => window.webContents.send('window-maximized'));
  window.on('unmaximize', () => window.webContents.send('window-unmaximized'));
});

// ═══════════════════════════════════════════════════════════
// 配置 IPC
// ═══════════════════════════════════════════════════════════
ipcMain.handle('get-config', () => config);

ipcMain.handle('save-config', (event, newConfig) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    config = newConfig;
    mainWindow?.webContents.send('config-loaded', config);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('config-updated', (event, newConfig) => {
  config = newConfig;
  mainWindow?.webContents.send('config-loaded', config);
});

// ═══════════════════════════════════════════════════════════
// 账户管理 IPC
// ═══════════════════════════════════════════════════════════

// 获取账户列表
ipcMain.handle('get-accounts', () => ({ accounts, currentAccount }));

// 添加离线账户
ipcMain.handle('add-offline-account', (event, username) => {
  if (!username || username.trim().length < 3) {
    return { success: false, error: '用户名至少需要3个字符' };
  }
  
  const uuid = crypto.randomUUID().replace(/-/g, '');
  const account = {
    id: uuid,
    type: 'offline',
    username: username.trim(),
    uuid: uuid,
    skin: null,
    createdAt: Date.now()
  };
  
  accounts.push(account);
  if (!currentAccount) {
    currentAccount = account.id;
  }
  
  saveAccounts();
  return { success: true, account, currentAccount };
});

// 删除账户
ipcMain.handle('remove-account', (event, accountId) => {
  const index = accounts.findIndex(a => a.id === accountId);
  if (index === -1) {
    return { success: false, error: '账户不存在' };
  }
  
  accounts.splice(index, 1);
  
  if (currentAccount === accountId) {
    currentAccount = accounts.length > 0 ? accounts[0].id : null;
  }
  
  saveAccounts();
  return { success: true, accounts, currentAccount };
});

// 切换当前账户
ipcMain.handle('switch-account', (event, accountId) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账户不存在' };
  }
  
  currentAccount = accountId;
  saveAccounts();
  return { success: true, currentAccount };
});

// 更新账户用户名（离线账户）
ipcMain.handle('update-account-username', (event, accountId, newUsername) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账户不存在' };
  }
  if (account.type !== 'offline') {
    return { success: false, error: '只能修改离线账户的用户名' };
  }
  
  account.username = newUsername.trim();
  saveAccounts();
  return { success: true, account };
});

// ═══════════════════════════════════════════════════════════
// 微软账号登录
// ═══════════════════════════════════════════════════════════

// 微软OAuth登录
ipcMain.handle('microsoft-login', async () => {
  return new Promise((resolve) => {
    const state = crypto.randomBytes(16).toString('hex');
    
    // 设置回调处理器
    authCallbackResolver = resolve;
    
    // 构建授权 URL
    const scope = 'XboxLive.signin offline_access';
    const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${AZURE_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}&prompt=select_account`;
    
    console.log('Opening authorization URL:', authUrl);
    
    // 打开浏览器
    shell.openExternal(authUrl);
    
    // 超时处理（5分钟）
    setTimeout(() => {
      if (authCallbackResolver) {
        authCallbackResolver({ success: false, error: '登录超时' });
        authCallbackResolver = null;
      }
    }, 300000);
  });
});

// 完成微软认证流程
async function completeMicrosoftAuth(code) {
  try {
    console.log('Starting Microsoft authentication flow...');
    
    // 1. 获取 Microsoft Token
    console.log('Step 1: Getting Microsoft Token...');
    const msToken = await getMicrosoftToken(code);
    console.log('Microsoft Token obtained successfully');
    
    // 2. Xbox Live 认证
    console.log('Step 2: Xbox Live authentication...');
    const xblToken = await getXboxLiveToken(msToken.access_token);
    console.log('Xbox Live Token obtained successfully');
    
    // 3. XSTS Token
    console.log('Step 3: Getting XSTS Token...');
    const xstsToken = await getXSTSToken(xblToken.Token);
    console.log('XSTS Token obtained successfully');
    
    // 4. Minecraft Token
    console.log('Step 4: Getting Minecraft Token...');
    const mcToken = await getMinecraftToken(xstsToken);
    console.log('Minecraft Token obtained successfully');
    
    // 5. 获取 Minecraft Profile
    console.log('Step 5: Getting Minecraft Profile...');
    const profile = await getMinecraftProfile(mcToken.access_token);
    console.log('Minecraft Profile:', profile);
    
    // 检查是否拥有 Minecraft
    if (!profile || !profile.id || !profile.name) {
      console.error('Profile 数据异常:', profile);
      throw new Error(
        '无法获取 Minecraft 账户信息\n\n' +
        '可能的原因：\n' +
        '1. Azure 应用的 API 权限配置不完整\n' +
        '2. 该微软账号未购买 Minecraft Java 版\n\n' +
        '解决方案：\n' +
        '• 查看 API_PERMISSIONS_FIX.md 配置 API 权限\n' +
        '• 或访问 minecraft.net/profile 确认有 Java 版\n' +
        '• 或使用离线账户'
      );
    }
    
    // 创建账户
    const account = {
      id: profile.id,
      type: 'microsoft',
      username: profile.name,
      uuid: profile.id,
      accessToken: mcToken.access_token,
      refreshToken: msToken.refresh_token,
      skin: profile.skins?.[0]?.url || null,
      createdAt: Date.now()
    };
    
    console.log('Account created successfully:', account.username);
    
    // 检查是否已存在
    const existingIndex = accounts.findIndex(a => a.id === account.id);
    if (existingIndex >= 0) {
      accounts[existingIndex] = account;
    } else {
      accounts.push(account);
    }
    
    currentAccount = account.id;
    saveAccounts();
    
    // 提取头像
    if (account.skin) {
      console.log('Extracting avatar...');
      await extractAvatarFromSkin(account.skin, account.id);
    }
    
    // 通知主窗口更新
    if (mainWindow) {
      mainWindow.webContents.send('accounts-loaded', { accounts, currentAccount });
    }
    
    console.log('Authentication flow completed!');
    return account;
  } catch (error) {
    console.error('认证流程失败:', error);
    throw error;
  }
}

// HTTP 请求辅助函数
function httpRequest(url, options, postData) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const req = protocol.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`HTTP ${options.method} ${url} - Status: ${res.statusCode}`);
        console.log('Response:', data.substring(0, 500)); // 只打印前 500 字符
        
        // 检查 HTTP 状态码
        if (res.statusCode === 404) {
          resolve({ error: 'NOT_FOUND', errorMessage: '该账号未拥有 Minecraft' });
          return;
        }
        
        if (res.statusCode >= 400) {
          resolve({ error: 'HTTP_ERROR', errorMessage: `HTTP ${res.statusCode}`, statusCode: res.statusCode });
          return;
        }
        
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch {
          // 如果不是 JSON，返回原始数据
          resolve(data);
        }
      });
    });
    
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getMicrosoftToken(code) {
  const params = new URLSearchParams({
    client_id: AZURE_CLIENT_ID,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI
  });
  
  console.log('Requesting Microsoft Token...');
  const result = await httpRequest('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, params.toString());
  
  if (result.error) {
    console.error('Microsoft Token 错误:', result);
    throw new Error(result.error_description || result.error);
  }
  
  return result;
}

async function getXboxLiveToken(accessToken) {
  return httpRequest('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
  }, JSON.stringify({
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${accessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  }));
}

async function getXSTSToken(xblToken) {
  return httpRequest('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
  }, JSON.stringify({
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  }));
}

async function getMinecraftToken(xstsData) {
  const uhs = xstsData.DisplayClaims.xui[0].uhs;
  return httpRequest('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    identityToken: `XBL3.0 x=${uhs};${xstsData.Token}`
  }));
}

async function getMinecraftProfile(accessToken) {
  try {
    const profile = await httpRequest('https://api.minecraftservices.com/minecraft/profile', {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Profile raw response:', JSON.stringify(profile, null, 2));
    
    // 检查响应
    if (profile.error) {
      console.error('Minecraft Profile 错误:', profile);
      throw new Error(profile.errorMessage || '无法获取 Minecraft 信息');
    }
    
    // 检查是否有必要的字段
    if (!profile.id || !profile.name) {
      console.error('Profile 缺少必要字段:', profile);
      throw new Error('API 返回的数据不完整，可能是权限配置问题\n\n请检查 Azure 应用的 API 权限配置');
    }
    
    return profile;
  } catch (error) {
    console.error('获取 Minecraft Profile 失败:', error);
    throw error;
  }
}

// 刷新微软账户
ipcMain.handle('refresh-microsoft-account', async (event, accountId) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account || account.type !== 'microsoft') {
    return { success: false, error: '账户不存在或不是微软账户' };
  }
  
  try {
    // 使用 refresh token 刷新
    const params = new URLSearchParams({
      client_id: AZURE_CLIENT_ID,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
      scope: 'XboxLive.signin offline_access'
    });
    
    const msToken = await httpRequest('https://login.live.com/oauth20_token.srf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, params.toString());
    
    if (msToken.error) {
      throw new Error(msToken.error_description || '刷新失败');
    }
    
    // 重新获取 Minecraft token
    const xblToken = await getXboxLiveToken(msToken.access_token);
    const xstsToken = await getXSTSToken(xblToken.Token);
    const mcToken = await getMinecraftToken(xstsToken);
    const profile = await getMinecraftProfile(mcToken.access_token);
    
    // 更新账户
    account.username = profile.name;
    account.accessToken = mcToken.access_token;
    account.refreshToken = msToken.refresh_token;
    account.skin = profile.skins?.[0]?.url || null;
    
    saveAccounts();
    return { success: true, account };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ═══════════════════════════════════════════════════════════
// 皮肤管理
// ═══════════════════════════════════════════════════════════

// 选择皮肤文件
ipcMain.handle('select-skin-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择皮肤文件',
    filters: [{ name: '图片', extensions: ['png'] }],
    properties: ['openFile']
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  
  const sourcePath = result.filePaths[0];
  return { success: true, path: sourcePath };
});

// 设置离线账户皮肤
ipcMain.handle('set-offline-skin', async (event, accountId, skinPath) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account || account.type !== 'offline') {
    return { success: false, error: '账户不存在或不是离线账户' };
  }
  
  try {
    // 复制皮肤到数据目录
    const skinFileName = `${accountId}.png`;
    const destPath = path.join(SKINS_DIR, skinFileName);
    fs.copyFileSync(skinPath, destPath);
    
    account.skin = destPath;
    saveAccounts();
    
    // 提取头像
    const avatarPath = await extractAvatarFromSkin(destPath, accountId);
    
    // 通知主窗口更新
    if (mainWindow) {
      mainWindow.webContents.send('accounts-loaded', { accounts, currentAccount });
    }
    
    return { success: true, account, skinPath: destPath, avatarPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取皮肤路径
ipcMain.handle('get-skin-path', (event, accountId) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账户不存在' };
  }
  return { success: true, skinPath: account.skin };
});

// ═══════════════════════════════════════════════════════════
// 头像提取
// ═══════════════════════════════════════════════════════════

// 从皮肤提取头像
async function extractAvatarFromSkin(skinPath, accountId) {
  try {
    // 如果没有 sharp 模块，直接返回默认头像
    if (!Sharp) {
      console.warn('Sharp not available, using default avatar');
      return getDefaultAvatar('steve');
    }
    
    let imageBuffer;
    
    // 如果是 URL，下载图片
    if (skinPath && skinPath.startsWith('http')) {
      imageBuffer = await downloadImage(skinPath);
    } else if (skinPath && fs.existsSync(skinPath)) {
      imageBuffer = fs.readFileSync(skinPath);
    } else {
      // 使用默认史蒂夫头像
      return getDefaultAvatar('steve');
    }
    
    // 使用 Sharp 提取头部（8x8 像素区域）
    const faceBuffer = await Sharp(imageBuffer)
      .extract({ left: 8, top: 8, width: 8, height: 8 }) // 提取脸部
      .resize(32, 32, { kernel: 'nearest' }) // 放大到 32x32，保持像素风格
      .png()
      .toBuffer();
    
    // 提取帽子层（覆盖层）
    const hatBuffer = await Sharp(imageBuffer)
      .extract({ left: 40, top: 8, width: 8, height: 8 }) // 提取帽子层
      .resize(32, 32, { kernel: 'nearest' })
      .png()
      .toBuffer();
    
    // 合成头像（脸部 + 帽子层）
    const avatarBuffer = await Sharp(faceBuffer)
      .composite([{ input: hatBuffer, blend: 'over' }])
      .png()
      .toBuffer();
    
    // 保存头像
    const avatarPath = path.join(AVATARS_DIR, `${accountId}.png`);
    fs.writeFileSync(avatarPath, avatarBuffer);
    
    console.log('Avatar extraction successful:', avatarPath);
    return avatarPath;
  } catch (error) {
    console.error('Failed to extract avatar:', error);
    return getDefaultAvatar('steve');
  }
}

// 下载图片
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// 获取默认头像
function getDefaultAvatar(type = 'steve') {
  // 返回默认头像路径（可以是内置的史蒂夫/Alex 头像）
  const defaultPath = path.join(__dirname, 'assets', 'resources', `${type}_head.png`);
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  // 如果没有默认头像文件，返回 null，前端会显示图标
  return null;
}

// 获取账户头像
ipcMain.handle('get-account-avatar', async (event, accountId) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账户不存在' };
  }
  
  // 检查是否已有头像缓存
  const cachedAvatar = path.join(AVATARS_DIR, `${accountId}.png`);
  if (fs.existsSync(cachedAvatar)) {
    return { success: true, avatarPath: cachedAvatar };
  }
  
  // 从皮肤提取头像
  if (account.skin) {
    const avatarPath = await extractAvatarFromSkin(account.skin, accountId);
    return { success: true, avatarPath };
  }
  
  // 返回默认头像
  const defaultAvatar = getDefaultAvatar('steve');
  return { success: true, avatarPath: defaultAvatar, isDefault: true };
});

// 刷新账户头像
ipcMain.handle('refresh-account-avatar', async (event, accountId) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    return { success: false, error: '账户不存在' };
  }
  
  // 删除旧头像缓存
  const cachedAvatar = path.join(AVATARS_DIR, `${accountId}.png`);
  if (fs.existsSync(cachedAvatar)) {
    fs.unlinkSync(cachedAvatar);
  }
  
  // 重新提取
  if (account.skin) {
    const avatarPath = await extractAvatarFromSkin(account.skin, accountId);
    return { success: true, avatarPath };
  }
  
  return { success: true, avatarPath: getDefaultAvatar('steve'), isDefault: true };
});

// ═══════════════════════════════════════════════════════════
// 应用生命周期
// ═══════════════════════════════════════════════════════════

// 注册自定义协议
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL);
}

// 处理自定义协议 URL（Windows）
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 有人试图运行第二个实例，我们应该聚焦我们的窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    
    // 处理协议 URL
    const url = commandLine.find(arg => arg.startsWith(`${CUSTOM_PROTOCOL}://`));
    if (url) {
      handleAuthCallback(url);
    }
  });

  app.whenReady().then(() => {
    createWindow();
    
    // 检查启动参数中是否有协议 URL
    const url = process.argv.find(arg => arg.startsWith(`${CUSTOM_PROTOCOL}://`));
    if (url) {
      handleAuthCallback(url);
    }
  });
}

// 处理协议 URL（macOS）
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 处理授权回调
function handleAuthCallback(url) {
  console.log('Received auth callback URL:', url);
  
  try {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');
    const errorDescription = urlObj.searchParams.get('error_description');
    
    if (authCallbackResolver) {
      if (error) {
        authCallbackResolver({ success: false, error: errorDescription || error });
      } else if (code && state) {
        // 完成认证
        completeMicrosoftAuth(code)
          .then(account => {
            authCallbackResolver({ success: true, account, currentAccount });
          })
          .catch(err => {
            authCallbackResolver({ success: false, error: err.message });
          });
      } else {
        authCallbackResolver({ success: false, error: '无效的回调参数' });
      }
      
      authCallbackResolver = null;
    }
  } catch (error) {
    console.error('Failed to parse auth callback URL:', error);
    if (authCallbackResolver) {
      authCallbackResolver({ success: false, error: '解析回调 URL 失败' });
      authCallbackResolver = null;
    }
  }
}
