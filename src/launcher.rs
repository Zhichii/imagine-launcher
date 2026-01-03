use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    #[serde(default)]
    pub minecraft_dir: Option<String>,
    #[serde(default)]
    pub minecraft_dirs: Vec<String>,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub memory: MemorySettings,
    #[serde(default)]
    pub window_size: WindowSize,
    #[serde(default)]
    pub version_settings: HashMap<String, VersionSettings>,
    #[serde(default = "default_launcher_behavior")]
    pub launcher_behavior: String,
    #[serde(default = "default_instances_layout")]
    pub instances_layout: String,
}

fn default_launcher_behavior() -> String { "keep-front".to_string() }
fn default_instances_layout() -> String { "auto".to_string() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemorySettings {
    pub min: u32,
    pub max: u32,
}

impl Default for MemorySettings {
    fn default() -> Self {
        Self { min: 512, max: 2048 }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
}

impl Default for WindowSize {
    fn default() -> Self {
        Self { width: 854, height: 480 }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VersionSettings {
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub memory_min: Option<u32>,
    #[serde(default)]
    pub memory_max: Option<u32>,
    #[serde(default)]
    pub memory_auto: bool,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    #[serde(default)]
    pub version_isolation: bool,
    #[serde(default)]
    pub jvm_args: Vec<String>,
    #[serde(default)]
    pub launcher_behavior: Option<String>,
    #[serde(default)]
    pub auto_complete_files: Option<bool>,
}


#[tauri::command]
pub async fn get_launcher_settings(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<LauncherSettings, String> {
    let state = state.lock().await;
    let settings = state.launcher_settings.clone();
    println!("[Launcher] get_launcher_settings: minecraft_dir={:?}, java_path={:?}", 
        settings.minecraft_dir, settings.java_path);
    println!("[Launcher] get_launcher_settings: version_settings={:?}", settings.version_settings);
    Ok(settings)
}

#[tauri::command]
pub async fn save_launcher_settings(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    println!("[Launcher] ========== save_launcher_settings ==========");
    println!("[Launcher] Received settings: {}", serde_json::to_string_pretty(&settings).unwrap_or_default());
    
    let mut state = state.lock().await;
    
    // 合并设置而不是完全替换
    // 这样可以保留未传入的字段（如 java_path）
    if let Some(minecraft_dir) = settings.get("minecraftDir").or(settings.get("minecraft_dir")).and_then(|v| v.as_str()) {
        state.launcher_settings.minecraft_dir = Some(minecraft_dir.to_string());
        println!("[Launcher] Updated minecraft_dir: {}", minecraft_dir);
    }
    
    if let Some(minecraft_dirs) = settings.get("minecraftDirs").or(settings.get("minecraft_dirs")).and_then(|v| v.as_array()) {
        state.launcher_settings.minecraft_dirs = minecraft_dirs.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        println!("[Launcher] Updated minecraft_dirs: {:?}", state.launcher_settings.minecraft_dirs);
    }
    
    if let Some(java_path) = settings.get("javaPath").or(settings.get("java_path")).and_then(|v| v.as_str()) {
        state.launcher_settings.java_path = Some(java_path.to_string());
        println!("[Launcher] Updated java_path: {}", java_path);
    }
    
    if let Some(memory) = settings.get("memory") {
        if let Some(min) = memory.get("min").and_then(|v| v.as_u64()) {
            state.launcher_settings.memory.min = min as u32;
        }
        if let Some(max) = memory.get("max").and_then(|v| v.as_u64()) {
            state.launcher_settings.memory.max = max as u32;
        }
        println!("[Launcher] Updated memory: {:?}", state.launcher_settings.memory);
    }
    
    if let Some(window_size) = settings.get("windowSize").or(settings.get("window_size")) {
        if let Some(width) = window_size.get("width").and_then(|v| v.as_u64()) {
            state.launcher_settings.window_size.width = width as u32;
        }
        if let Some(height) = window_size.get("height").and_then(|v| v.as_u64()) {
            state.launcher_settings.window_size.height = height as u32;
        }
        println!("[Launcher] Updated window_size: {:?}", state.launcher_settings.window_size);
    }
    
    if let Some(version_settings) = settings.get("versionSettings").or(settings.get("version_settings")) {
        println!("[Launcher] Received versionSettings: {}", version_settings);
        if let Ok(vs) = serde_json::from_value::<std::collections::HashMap<String, VersionSettings>>(version_settings.clone()) {
            println!("[Launcher] Parsed version_settings: {:?}", vs);
            for (vid, vsettings) in &vs {
                println!("[Launcher] Version {} settings: launcherBehavior={:?}", vid, vsettings.launcher_behavior);
            }
            state.launcher_settings.version_settings = vs;
            println!("[Launcher] Updated version_settings");
        } else {
            println!("[Launcher] Failed to parse versionSettings");
        }
    }
    
    if let Some(behavior) = settings.get("launcherBehavior").or(settings.get("launcher_behavior")).and_then(|v| v.as_str()) {
        state.launcher_settings.launcher_behavior = behavior.to_string();
    }
    
    if let Some(layout) = settings.get("instancesLayout").or(settings.get("instances_layout")).and_then(|v| v.as_str()) {
        state.launcher_settings.instances_layout = layout.to_string();
    }
    
    println!("[Launcher] Final java_path after merge: {:?}", state.launcher_settings.java_path);
    
    state.save_launcher_settings().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn get_default_minecraft_dir() -> Result<String, String> {
    let dir = get_default_mc_dir();
    Ok(dir.to_string_lossy().to_string())
}

pub fn get_default_mc_dir() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return std::path::PathBuf::from(appdata).join(".minecraft");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return home.join("Library/Application Support/minecraft");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            return home.join(".minecraft");
        }
    }
    dirs::home_dir().unwrap_or_default().join(".minecraft")
}

#[tauri::command]
pub async fn validate_minecraft_dir(dir_path: String) -> Result<bool, String> {
    let path = std::path::Path::new(&dir_path);
    Ok(path.exists() && path.join("versions").exists())
}

#[tauri::command]
pub async fn select_minecraft_dir(
    _state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<serde_json::Value, String> {
    // 前端使用 dialog plugin 选择目录后调用 set_minecraft_dir
    Ok(serde_json::json!({
        "success": false,
        "error": "请使用前端dialog选择目录"
    }))
}

#[tauri::command]
pub async fn set_minecraft_dir(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    dir_path: String,
) -> Result<serde_json::Value, String> {
    let path = std::path::Path::new(&dir_path);
    if !path.exists() || !path.join("versions").exists() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "所选目录不是有效的 .minecraft 目录"
        }));
    }
    
    let mut state = state.lock().await;
    state.launcher_settings.minecraft_dir = Some(dir_path.clone());
    state.save_launcher_settings().map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "path": dir_path
    }))
}

#[tauri::command]
pub async fn get_minecraft_dir(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    let state = state.lock().await;
    Ok(state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string()))
}


#[tauri::command]
pub async fn get_system_memory() -> Result<serde_json::Value, String> {
    use sysinfo::System;
    let sys = System::new_all();
    
    let total = sys.total_memory() / (1024 * 1024); // MB
    let free = sys.available_memory() / (1024 * 1024);
    let used = total - free;
    
    Ok(serde_json::json!({
        "total": total,
        "free": free,
        "used": used
    }))
}

// Java 检测
#[tauri::command]
pub async fn detect_java() -> Result<serde_json::Value, String> {
    let java_list = find_java_installations().await;
    Ok(serde_json::json!({
        "success": true,
        "javaList": java_list
    }))
}

#[derive(Debug, Serialize)]
struct JavaInfo {
    path: String,
    version: String,
    name: String,
}

async fn find_java_installations() -> Vec<JavaInfo> {
    let mut results = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();
    
    // 检查 PATH 中的 java
    if let Ok(version) = get_java_version_cmd("java").await {
        results.push(JavaInfo {
            path: "java".to_string(),
            version,
            name: "System Java".to_string(),
        });
        seen_paths.insert("java".to_string());
    }
    
    // 检查 JAVA_HOME
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        #[cfg(target_os = "windows")]
        let java_bin = Path::new(&java_home).join("bin").join("java.exe");
        #[cfg(not(target_os = "windows"))]
        let java_bin = Path::new(&java_home).join("bin").join("java");
        
        if java_bin.exists() {
            let path_str = java_bin.to_string_lossy().to_string();
            if !seen_paths.contains(&path_str) {
                if let Ok(version) = get_java_version_cmd(&path_str).await {
                    results.push(JavaInfo {
                        path: path_str.clone(),
                        version,
                        name: "JAVA_HOME".to_string(),
                    });
                    seen_paths.insert(path_str);
                }
            }
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        let search_paths = vec![
            std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string()),
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string()),
            std::env::var("LOCALAPPDATA").unwrap_or_default(),
            std::env::var("APPDATA").unwrap_or_default(),
            "C:\\".to_string(),
        ];
        
        let java_dirs = vec![
            "Java", "Eclipse Adoptium", "Zulu", "Microsoft", "BellSoft",
            "Amazon Corretto", "Liberica", "SapMachine", "ojdkbuild",
            "AdoptOpenJDK", "Temurin", "Semeru", "GraalVM", "OpenJDK",
        ];
        
        for base in &search_paths {
            let base_path = Path::new(base);
            for dir in &java_dirs {
                let search_dir = base_path.join(dir);
                if search_dir.exists() {
                    scan_java_dir_recursive(&search_dir, &mut results, &mut seen_paths, 2).await;
                }
            }
        }
        
        // 搜索常见的 Minecraft 启动器 Java
        let mc_launchers = vec![
            Path::new(&std::env::var("APPDATA").unwrap_or_default()).join(".minecraft").join("runtime"),
            Path::new(&std::env::var("LOCALAPPDATA").unwrap_or_default()).join("Packages"),
        ];
        
        for launcher_path in mc_launchers {
            if launcher_path.exists() {
                scan_java_dir_recursive(&launcher_path, &mut results, &mut seen_paths, 4).await;
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        let search_paths = vec![
            "/Library/Java/JavaVirtualMachines".to_string(),
            format!("{}/Library/Java/JavaVirtualMachines", dirs::home_dir().unwrap_or_default().display()),
            "/usr/local/opt".to_string(),
        ];
        for path in search_paths {
            let p = Path::new(&path);
            if p.exists() {
                scan_java_dir_recursive(p, &mut results, &mut seen_paths, 3).await;
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        let search_paths = vec!["/usr/lib/jvm", "/usr/java", "/opt/java", "/opt"];
        for path in search_paths {
            let p = Path::new(path);
            if p.exists() {
                scan_java_dir_recursive(p, &mut results, &mut seen_paths, 2).await;
            }
        }
    }
    
    // 按版本排序（新版本在前）
    results.sort_by(|a, b| {
        let va = parse_java_version(&a.version);
        let vb = parse_java_version(&b.version);
        vb.cmp(&va)
    });
    
    results
}

fn parse_java_version(version: &str) -> u32 {
    // 解析 Java 版本号，如 "1.8.0_301" -> 8, "17.0.1" -> 17, "21" -> 21
    let v = version.trim_start_matches("1.");
    v.split(|c: char| !c.is_numeric())
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

async fn scan_java_dir_recursive(
    dir: &Path, 
    results: &mut Vec<JavaInfo>, 
    seen: &mut std::collections::HashSet<String>,
    max_depth: u32
) {
    if max_depth == 0 {
        return;
    }
    
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            
            if path.is_dir() {
                // 检查这个目录是否包含 Java
                #[cfg(target_os = "windows")]
                let java_bin = path.join("bin").join("java.exe");
                #[cfg(not(target_os = "windows"))]
                let java_bin = path.join("bin").join("java");
                
                // macOS 特殊路径
                #[cfg(target_os = "macos")]
                let java_bin = if java_bin.exists() {
                    java_bin
                } else {
                    path.join("Contents/Home/bin/java")
                };
                
                if java_bin.exists() {
                    let path_str = java_bin.to_string_lossy().to_string();
                    if !seen.contains(&path_str) {
                        if let Ok(version) = get_java_version_cmd(&path_str).await {
                            let name = path.file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| "Unknown".to_string());
                            results.push(JavaInfo {
                                path: path_str.clone(),
                                version,
                                name,
                            });
                            seen.insert(path_str);
                        }
                    }
                } else {
                    // 递归搜索子目录
                    Box::pin(scan_java_dir_recursive(&path, results, seen, max_depth - 1)).await;
                }
            }
        }
    }
}

async fn get_java_version_cmd(java_path: &str) -> Result<String, String> {
    let output = tokio::process::Command::new(java_path)
        .arg("-version")
        .output()
        .await
        .map_err(|e| e.to_string())?;
    
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}{}", stderr, stdout);
    
    let re = regex::Regex::new(r#"version "([^"]+)""#).unwrap();
    if let Some(caps) = re.captures(&combined) {
        return Ok(caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default());
    }
    
    Err("无法解析Java版本".to_string())
}


#[tauri::command]
pub async fn select_java_path() -> Result<serde_json::Value, String> {
    // 前端使用 dialog plugin 选择文件
    Ok(serde_json::json!({
        "success": false,
        "error": "请使用前端dialog选择文件"
    }))
}

#[tauri::command]
pub async fn set_java_path(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    java_path: String,
) -> Result<serde_json::Value, String> {
    println!("[Java] Setting Java path: {}", java_path);
    
    let version = get_java_version_cmd(&java_path).await;
    
    if version.is_err() {
        println!("[Java] Failed to get version: {:?}", version);
        return Ok(serde_json::json!({
            "success": false,
            "error": "无法识别 Java 版本"
        }));
    }
    
    let version_str = version.unwrap();
    println!("[Java] Detected version: {}", version_str);
    
    let mut state = state.lock().await;
    state.launcher_settings.java_path = Some(java_path.clone());
    
    println!("[Java] Saving settings...");
    state.save_launcher_settings().map_err(|e| {
        println!("[Java] Save error: {}", e);
        e.to_string()
    })?;
    
    println!("[Java] Java path saved successfully");
    
    Ok(serde_json::json!({
        "success": true,
        "path": java_path,
        "version": version_str
    }))
}

#[tauri::command]
pub async fn get_java_path(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Option<String>, String> {
    let state = state.lock().await;
    let java_path = state.launcher_settings.java_path.clone();
    println!("[Java] get_java_path: {:?}", java_path);
    Ok(java_path)
}

#[tauri::command]
pub async fn get_required_java_version(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    version_id: String,
) -> Result<Option<u32>, String> {
    let state = state.lock().await;
    let mc_dir = state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    let json_path = std::path::Path::new(&mc_dir)
        .join("versions")
        .join(&version_id)
        .join(format!("{}.json", version_id));
    
    if !json_path.exists() {
        return Ok(None);
    }
    
    let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    if let Some(java_version) = json.get("javaVersion").and_then(|v| v.get("majorVersion")) {
        return Ok(java_version.as_u64().map(|v| v as u32));
    }
    
    // 根据版本推断
    let id_lower = version_id.to_lowercase();
    if id_lower.contains("1.20") || id_lower.contains("1.21") {
        return Ok(Some(21));
    }
    if id_lower.contains("1.18") || id_lower.contains("1.19") {
        return Ok(Some(17));
    }
    if id_lower.contains("1.17") {
        return Ok(Some(16));
    }
    
    Ok(Some(8))
}

// 启动器行为
#[tauri::command]
pub async fn get_launcher_behavior(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    let state = state.lock().await;
    Ok(state.launcher_settings.launcher_behavior.clone())
}

#[tauri::command]
pub async fn set_launcher_behavior(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    behavior: String,
) -> Result<serde_json::Value, String> {
    let mut state = state.lock().await;
    state.launcher_settings.launcher_behavior = behavior;
    state.save_launcher_settings().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn execute_launcher_behavior(
    window: tauri::Window,
    behavior: String,
) -> Result<serde_json::Value, String> {
    println!("[Launcher] Executing behavior: {}", behavior);
    match behavior.as_str() {
        "auto-hide" => {
            println!("[Launcher] Hiding window (auto-hide)");
            let _ = window.hide();
        }
        "auto-exit" => {
            println!("[Launcher] Exiting (auto-exit)");
            std::thread::sleep(std::time::Duration::from_secs(1));
            std::process::exit(0);
        }
        "hide-when-game-front" => {
            // 隐藏窗口，进程监控会在游戏退出时恢复
            println!("[Launcher] Hiding window (hide-when-game-front)");
            let _ = window.hide();
        }
        _ => {
            println!("[Launcher] Keeping window front (keep-front)");
        } // keep-front: 不做任何操作
    }
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn get_instances_layout(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    let state = state.lock().await;
    Ok(state.launcher_settings.instances_layout.clone())
}

#[tauri::command]
pub async fn set_instances_layout(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    layout: String,
) -> Result<serde_json::Value, String> {
    let mut state = state.lock().await;
    state.launcher_settings.instances_layout = layout;
    state.save_launcher_settings().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}
