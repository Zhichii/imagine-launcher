// Tauri API 桥接 - 供 iframe 页面使用

// 等待 Tauri API 加载
const waitForTauri = () => {
  return new Promise((resolve) => {
    const check = () => {
      if (window.__TAURI__ || window.parent?.__TAURI__) {
        resolve(getTauriAPI());
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
};

const getTauriAPI = () => {
  if (window.__TAURI__) return window.__TAURI__;
  if (window.parent?.__TAURI__) return window.parent.__TAURI__;
  return null;
};

// 模拟 Electron 的 ipcRenderer
const ipcRenderer = {
  invoke: async (channel, ...args) => {
    // 等待 Tauri API 可用
    let tauri = getTauriAPI();
    if (!tauri) {
      tauri = await waitForTauri();
    }
    if (!tauri) {
      console.error('Tauri API not available');
      return null;
    }
    
    // 特殊处理：目录选择
    if (channel === 'select-minecraft-dir') {
      try {
        const selected = await tauri.dialog.open({
          directory: true,
          multiple: false,
          title: '选择 .minecraft 目录'
        });
        if (selected) {
          // 调用后端验证并保存
          return await tauri.core.invoke('set_minecraft_dir', { dirPath: selected });
        }
        return { success: false, canceled: true };
      } catch (error) {
        console.error('Select dir error:', error);
        return { success: false, error: error.toString() };
      }
    }
    
    // 特殊处理：Java 路径选择
    if (channel === 'select-java-path') {
      try {
        const selected = await tauri.dialog.open({
          directory: false,
          multiple: false,
          title: '选择 Java 可执行文件',
          filters: [{
            name: 'Java',
            extensions: ['exe', '']
          }]
        });
        if (selected) {
          return await tauri.core.invoke('set_java_path', { javaPath: selected });
        }
        return { success: false, canceled: true };
      } catch (error) {
        console.error('Select java error:', error);
        return { success: false, error: error.toString() };
      }
    }
    
    // 特殊处理：皮肤文件选择
    if (channel === 'select-skin-file') {
      try {
        const selected = await tauri.dialog.open({
          directory: false,
          multiple: false,
          title: '选择皮肤文件',
          filters: [{
            name: 'Image',
            extensions: ['png']
          }]
        });
        if (selected) {
          return { success: true, path: selected };
        }
        return { success: false, canceled: true };
      } catch (error) {
        console.error('Select skin error:', error);
        return { success: false, error: error.toString() };
      }
    }
    
    const command = channel.replace(/-/g, '_');
    let params = {};
    
    // 特殊处理需要包装参数的命令
    const wrapperCommands = ['save_launcher_settings', 'save_config'];
    
    if (args.length === 1 && typeof args[0] === 'object') {
      // 检查是否需要包装参数
      if (wrapperCommands.includes(command)) {
        // 这些命令需要特殊的参数名
        switch (command) {
          case 'save_launcher_settings':
            params = { settings: args[0] };
            break;
          case 'save_config':
            params = { newConfig: args[0] };
            break;
        }
      } else {
        params = args[0];
      }
    } else if (args.length > 0) {
      switch (command) {
        case 'add_offline_account':
          params = { username: args[0] };
          break;
        case 'remove_account':
        case 'switch_account':
        case 'get_account_avatar':
        case 'refresh_account_avatar':
          params = { accountId: args[0] };
          break;
        case 'update_account_username':
          params = { accountId: args[0], newUsername: args[1] };
          break;
        case 'set_offline_skin':
          params = { accountId: args[0], skinPath: args[1] };
          break;
        case 'get_skin_path':
          params = { accountId: args[0] };
          break;
        case 'validate_minecraft_dir':
        case 'set_minecraft_dir':
          params = { dirPath: args[0] };
          break;
        case 'set_java_path':
          params = { javaPath: args[0] };
          break;
        case 'get_version_info':
        case 'get_required_java_version':
          params = { versionId: args[0] };
          break;
        case 'launch_game':
          // 支持两种调用方式：
          // 1. 对象参数: { versionId, accountId, forceNewInstance }
          // 2. 位置参数: versionId, accountId
          if (args.length === 1 && typeof args[0] === 'object') {
            params = {
              versionId: args[0].versionId || args[0].version_id,
              accountId: args[0].accountId || args[0].account_id || null,
              forceNewInstance: args[0].forceNewInstance || args[0].force_new_instance || false
            };
          } else {
            params = {
              versionId: args[0],
              accountId: args[1] || null,
              forceNewInstance: args[2] || false
            };
          }
          console.log('[Bridge] launch_game params:', params);
          break;
        case 'save_config':
          params = { newConfig: args[0] };
          break;
        case 'save_launcher_settings':
          params = { settings: args[0] };
          break;
        case 'set_launcher_behavior':
        case 'execute_launcher_behavior':
          params = { behavior: args[0] };
          break;
        case 'set_instances_layout':
          params = { layout: args[0] };
          break;
        case 'manual_auth_callback':
          params = { callbackUrl: args[0] };
          break;
        case 'refresh_microsoft_account':
          params = { accountId: args[0] };
          break;
        case 'get_instance_logs':
        case 'kill_instance':
          params = { pid: args[0] };
          break;
        case 'check_duplicate_instance':
          params = { versionId: args[0] };
          break;
        case 'rename_version':
          params = { oldId: args[0], newId: args[1] };
          break;
        // Mods 管理
        case 'scan_mods':
          params = { modsDir: args[0] };
          break;
        case 'toggle_mod':
          params = { modsDir: args[0], file: args[1], enabled: args[2] };
          break;
        case 'delete_mod':
          params = { modsDir: args[0], file: args[1] };
          break;
        case 'copy_mod_to_dir':
          params = { sourcePath: args[0], modsDir: args[1] };
          break;
        // 存档管理
        case 'scan_worlds':
          params = { savesDir: args[0] };
          break;
        case 'delete_world':
          params = { savesDir: args[0], folder: args[1] };
          break;
        // 资源包管理
        case 'scan_resourcepacks':
          params = { resourcepacksDir: args[0] };
          break;
        // 文件操作
        case 'open_folder':
          params = { folderPath: args[0] };
          break;
        case 'delete_file':
          params = { filePath: args[0] };
          break;
        case 'copy_file_to_dir':
          params = { sourcePath: args[0], destDir: args[1] };
          break;
        // 下载相关
        case 'download_minecraft_version':
          params = { versionId: args[0], manifestUrl: args[1] };
          break;
        case 'install_fabric':
          params = { mcVersion: args[0], loaderVersion: args[1] };
          break;
        case 'install_forge':
          params = { mcVersion: args[0], forgeVersion: args[1] };
          break;
        case 'install_quilt':
          params = { mcVersion: args[0], loaderVersion: args[1] };
          break;
        case 'get_forge_versions':
          params = { mcVersion: args[0] };
          break;
        case 'complete_game_files':
          params = { versionId: args[0] };
          break;
      }
    }
    
    try {
      return await tauri.core.invoke(command, params);
    } catch (error) {
      console.error(`Tauri invoke error (${command}):`, error);
      throw error;
    }
  },
  
  send: async (channel, ...args) => {
    let tauri = getTauriAPI();
    if (!tauri) tauri = await waitForTauri();
    if (tauri) tauri.event.emit(channel, args[0]);
  },
  
  on: async (channel, callback) => {
    let tauri = getTauriAPI();
    if (!tauri) tauri = await waitForTauri();
    if (tauri) {
      tauri.event.listen(channel, (event) => callback(event, event.payload));
    }
  }
};

// 文件系统
const fs = {
  existsSync: () => true,
  readFileSync: () => ''
};

// 路径
const path = {
  join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
  dirname: (p) => p.split('/').slice(0, -1).join('/'),
  basename: (p) => p.split('/').pop(),
};

// Shell
const shell = {
  openExternal: async (url) => {
    let tauri = getTauriAPI();
    if (!tauri) tauri = await waitForTauri();
    if (tauri?.shell) await tauri.shell.open(url);
  }
};

// 导出
window.ipcRenderer = ipcRenderer;
window.fs = fs;
window.path = path;
window.shell = shell;
window.require = (module) => {
  switch (module) {
    case 'electron': return { ipcRenderer, shell };
    case 'fs': return fs;
    case 'path': return path;
    default: return {};
  }
};

console.log('Tauri bridge loaded');
