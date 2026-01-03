// 版本信息加载器 - TypeScript 版本
// 解析 version.ini 文件并提供统一的版本信息访问接口

console.log('[VersionLoader] Script starting to execute...');
console.log('[VersionLoader] Current location:', window.location.href);

/**
 * 版本信息数据结构
 */
interface VersionInfo {
  NAME: {
    V_NO_UNDERLINE_NAME: string;
    V_FULL_VERSION: string;
    NO_UNDERLINE_NAME: string;
    FULL_VERSION: string;
  };
  VERSION: {
    VERSION: string;
    CHANNEL: string;
    DATE: string;
  };
  UI_VERSION: {
    UI_VERSION: string;
  };
  DEV: {
    DEV: string;
  };
}

/**
 * INI 文件解析结果
 */
interface INIData {
  [section: string]: {
    [key: string]: string;
  };
}

/**
 * 版本通道类型
 */
type VersionChannel = 'alpha' | 'beta' | 'stable' | 'release' | 'rc' | 'snapshot';

let versionInfo: VersionInfo | null = null;

/**
 * 解析 INI 文件内容
 * @param text INI 文件文本内容
 * @returns 解析后的数据对象
 */
function parseINI(text: string): INIData {
  console.log('[Version] Parsing INI file, length:', text.length);
  console.log('[Version] First 200 chars:', text.substring(0, 200));
  
  const result: INIData = {};
  let currentSection: string | null = null;
  
  text.split('\n').forEach((line) => {
    line = line.trim();
    
    // 跳过空行和注释
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      return;
    }
    
    // 解析 section [NAME]
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result[currentSection] = {};
      console.log(`[Version] Found section: ${currentSection}`);
      return;
    }
    
    // 解析 key=value
    const keyValueMatch = line.match(/^([^=]+)=(.*)$/);
    if (keyValueMatch && currentSection) {
      const key = keyValueMatch[1].trim();
      const value = keyValueMatch[2].trim();
      result[currentSection][key] = value;
      console.log(`[Version] ${currentSection}.${key} = ${value}`);
    }
  });
  
  console.log('[Version] Parsed result:', result);
  return result;
}

/**
 * 加载版本信息
 * 每次调用都会重新从文件加载，不使用缓存
 * @returns 版本信息对象
 */
async function loadVersionInfo(): Promise<VersionInfo> {
  try {
    // 添加时间戳防止浏览器缓存
    const timestamp = new Date().getTime();
    
    // 修复路径：根据当前页面位置计算相对路径
    // 如果在 iframe 中（路径包含 /pages/），需要使用 ../../
    const basePath = window.location.pathname.includes('/pages/') ? '../../' : '';
    const url = `${basePath}version/version.ini?t=${timestamp}`;
    
    console.log('[Version] Loading from URL:', url);
    console.log('[Version] Current location:', window.location.href);
    console.log('[Version] Base path:', basePath);
    
    const response = await fetch(url);
    console.log('[Version] Fetch response status:', response.status);
    console.log('[Version] Fetch response ok:', response.ok);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log('[Version] Fetched text length:', text.length);
    console.log('[Version] Full text content:');
    console.log(text);
    
    const parsed = parseINI(text);
    
    // 类型转换：先转为 unknown 再转为 VersionInfo
    versionInfo = parsed as unknown as VersionInfo;
    console.log('[Version] Final versionInfo object:', versionInfo);
    console.log('[Version] VERSION section:', versionInfo.VERSION);
    console.log('[Version] VERSION.VERSION value:', versionInfo?.VERSION?.VERSION);
    
    return versionInfo;
  } catch (error) {
    console.error('[Version] Failed to load version.ini:', error);
    if (error instanceof Error) {
      console.error('[Version] Error message:', error.message);
      console.error('[Version] Error stack:', error.stack);
    }
    
    // 返回默认值
    const defaultInfo: VersionInfo = {
      NAME: {
        V_NO_UNDERLINE_NAME: 'v0.0.1Alpha',
        V_FULL_VERSION: 'v0.0.1-Alpha',
        NO_UNDERLINE_NAME: '0.0.1Alpha',
        FULL_VERSION: '0.0.1-Alpha'
      },
      VERSION: {
        VERSION: '0.0.1',
        CHANNEL: 'alpha',
        DATE: '2026/01/02'
      },
      UI_VERSION: {
        UI_VERSION: '1.0.3'
      },
      DEV: {
        DEV: 'ZZBuAoYe'
      }
    };
    
    versionInfo = defaultInfo;
    console.log('[Version] Using default version info');
    return defaultInfo;
  }
}

/**
 * 获取版本号（纯数字，如 0.0.1）
 */
function getVersion(): string {
  const version = versionInfo?.VERSION?.VERSION || '0.0.1';
  console.log('[Version] getVersion() called, returning:', version);
  console.log('[Version] Current versionInfo:', versionInfo);
  return version;
}

/**
 * 获取完整版本号（带 v 前缀和 channel，如 v0.0.1-Alpha）
 */
function getFullVersion(): string {
  return versionInfo?.NAME?.V_FULL_VERSION || 'v0.0.1-Alpha';
}

/**
 * 获取无下划线的版本名称（如 0.0.1Alpha）
 */
function getNoUnderlineName(): string {
  return versionInfo?.NAME?.NO_UNDERLINE_NAME || '0.0.1Alpha';
}

/**
 * 获取带 v 前缀的无下划线版本名称（如 v0.0.1Alpha）
 */
function getVNoUnderlineName(): string {
  return versionInfo?.NAME?.V_NO_UNDERLINE_NAME || 'v0.0.1Alpha';
}

/**
 * 获取版本通道（如 alpha, beta, stable）
 */
function getChannel(): VersionChannel {
  return (versionInfo?.VERSION?.CHANNEL || 'alpha') as VersionChannel;
}

/**
 * 获取发布日期
 */
function getDate(): string {
  return versionInfo?.VERSION?.DATE || '2026/01/02';
}

/**
 * 获取 UI 框架版本
 */
function getUIVersion(): string {
  return versionInfo?.UI_VERSION?.UI_VERSION || '1.0.3';
}

/**
 * 获取开发者名称
 */
function getDeveloper(): string {
  return versionInfo?.DEV?.DEV || 'ZZBuAoYe';
}

/**
 * 获取通道的显示标签
 * @param channel 版本通道
 * @returns 显示用的标签文本
 */
function getChannelLabel(channel?: string): string {
  const labels: Record<string, string> = {
    alpha: 'Alpha',
    beta: 'Beta',
    stable: 'Stable',
    release: 'Release',
    rc: 'RC',
    snapshot: 'Snapshot'
  };
  
  const channelKey = (channel || getChannel()).toLowerCase();
  return labels[channelKey] || channel || 'Alpha';
}

/**
 * 获取原始版本信息对象
 * @returns 完整的版本信息对象，如果未加载则返回 null
 */
function getRawVersionInfo(): VersionInfo | null {
  return versionInfo;
}

/**
 * 版本加载器导出接口
 */
const VersionLoader = {
  load: loadVersionInfo,
  getVersion,
  getFullVersion,
  getNoUnderlineName,
  getVNoUnderlineName,
  getChannel,
  getDate,
  getUIVersion,
  getDeveloper,
  getChannelLabel,
  getRawVersionInfo
};

// 挂载到 window 对象
if (typeof window !== 'undefined') {
  (window as any).VersionLoader = VersionLoader;
  console.log('[VersionLoader] Successfully mounted to window.VersionLoader');
  console.log('[VersionLoader] Available methods:', Object.keys(VersionLoader));
} else {
  console.error('[VersionLoader] window object not available!');
}
