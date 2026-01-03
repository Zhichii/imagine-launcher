// Downloads Module - MC版本下载和加载器安装
use crate::launcher::get_default_mc_dir;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::Mutex;
use futures_util::StreamExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    pub release_time: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: Option<String>,
    pub main_class: Option<String>,
    pub minecraft_arguments: Option<String>,
    pub arguments: Option<serde_json::Value>,
    pub libraries: Option<Vec<Library>>,
    pub downloads: Option<Downloads>,
    pub asset_index: Option<AssetIndex>,
    pub assets: Option<String>,
    pub inherits_from: Option<String>,
    pub release_time: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Downloads {
    pub client: Option<DownloadInfo>,
    pub server: Option<DownloadInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadInfo {
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssetIndex {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
    #[serde(rename = "totalSize")]
    pub total_size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub url: Option<String>,
    pub rules: Option<Vec<serde_json::Value>>,
    pub natives: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<LibraryArtifact>,
    pub classifiers: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LibraryArtifact {
    pub path: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

// 带进度的文件下载
async fn download_file_with_progress(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    app_handle: &tauri::AppHandle,
    base_progress: u32,
    progress_range: u32,
    file_name: &str,
) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    
    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_update = Instant::now();
    let mut last_downloaded: u64 = 0;
    
    // 创建父目录
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        
        // 每 100ms 更新一次进度
        if last_update.elapsed().as_millis() >= 100 {
            let speed = ((downloaded - last_downloaded) as f64 / last_update.elapsed().as_secs_f64()) as u64;
            let speed_str = format_speed(speed);
            
            let progress = if total_size > 0 {
                base_progress + ((downloaded as f32 / total_size as f32) * progress_range as f32) as u32
            } else {
                base_progress
            };
            
            let status = format!("下载 {} ({})", file_name, speed_str);
            send_progress_detailed(app_handle, progress, &status, file_name, downloaded, total_size, speed);
            
            last_update = Instant::now();
            last_downloaded = downloaded;
        }
    }
    
    Ok(())
}

// 格式化下载速度
fn format_speed(bytes_per_sec: u64) -> String {
    if bytes_per_sec >= 1024 * 1024 {
        format!("{:.2} MB/s", bytes_per_sec as f64 / (1024.0 * 1024.0))
    } else if bytes_per_sec >= 1024 {
        format!("{:.2} KB/s", bytes_per_sec as f64 / 1024.0)
    } else {
        format!("{} B/s", bytes_per_sec)
    }
}

// 发送详细进度
fn send_progress_detailed(
    app_handle: &tauri::AppHandle,
    percent: u32,
    status: &str,
    file: &str,
    downloaded: u64,
    total: u64,
    speed: u64,
) {
    let _ = app_handle.emit("download-progress", serde_json::json!({
        "percent": percent,
        "status": status,
        "file": file,
        "downloaded": downloaded,
        "total": total,
        "speed": speed,
        "speedText": format_speed(speed)
    }));
}

// 下载 Minecraft 版本
#[tauri::command]
pub async fn download_minecraft_version(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
    version_id: String,
    manifest_url: String,
) -> Result<serde_json::Value, String> {
    println!("[Download] Starting download for version: {}", version_id);
    
    let app_state = state.lock().await;
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    drop(app_state);
    
    let mc_path = Path::new(&mc_dir);
    let versions_dir = mc_path.join("versions");
    let version_dir = versions_dir.join(&version_id);
    let libraries_dir = mc_path.join("libraries");
    
    // 创建目录
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&libraries_dir).map_err(|e| e.to_string())?;
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    
    // 1. 下载版本 JSON
    send_progress(&app_handle, 2, "下载版本信息...", "");
    
    let version_json: VersionJson = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    
    // 保存版本 JSON
    let json_path = version_dir.join(format!("{}.json", version_id));
    let json_content = serde_json::to_string_pretty(&version_json).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, json_content).map_err(|e| e.to_string())?;
    
    // 2. 下载客户端 JAR（带进度）
    send_progress(&app_handle, 5, "下载游戏客户端...", &format!("{}.jar", version_id));
    
    if let Some(downloads) = &version_json.downloads {
        if let Some(client_info) = &downloads.client {
            let jar_path = version_dir.join(format!("{}.jar", version_id));
            download_file_with_progress(
                &client,
                &client_info.url,
                &jar_path,
                &app_handle,
                5,
                25, // 5% - 30%
                &format!("{}.jar", version_id),
            ).await?;
        }
    }
    
    // 3. 下载库文件
    send_progress(&app_handle, 30, "下载依赖库...", "");
    
    if let Some(libraries) = &version_json.libraries {
        let total = libraries.len();
        let mut downloaded_count = 0;
        
        for lib in libraries.iter() {
            if !check_library_rules(&lib.rules) {
                continue;
            }
            
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    let lib_path = libraries_dir.join(&artifact.path);
                    if !lib_path.exists() {
                        if let Some(parent) = lib_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }
                        
                        let file_name = artifact.path.split('/').last().unwrap_or(&artifact.path);
                        let progress = 30 + (downloaded_count as f32 / total as f32 * 40.0) as u32;
                        
                        // 使用带进度的下载
                        if let Err(e) = download_file_with_progress(
                            &client,
                            &artifact.url,
                            &lib_path,
                            &app_handle,
                            progress,
                            1, // 每个库占 1%
                            file_name,
                        ).await {
                            println!("[Download] Failed to download library {}: {}", artifact.path, e);
                        }
                        
                        downloaded_count += 1;
                    }
                }
            }
        }
    }
    
    // 4. 下载资源索引
    send_progress(&app_handle, 75, "下载资源索引...", "");
    
    if let Some(asset_index) = &version_json.asset_index {
        let indexes_dir = mc_path.join("assets").join("indexes");
        std::fs::create_dir_all(&indexes_dir).ok();
        
        let index_path = indexes_dir.join(format!("{}.json", asset_index.id));
        if !index_path.exists() {
            download_file(&client, &asset_index.url, &index_path).await?;
        }
    }
    
    send_progress(&app_handle, 100, "下载完成", "");
    
    Ok(serde_json::json!({
        "success": true,
        "versionId": version_id
    }))
}

// 安装 Fabric
#[tauri::command]
pub async fn install_fabric(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
    mc_version: String,
    loader_version: String,
) -> Result<serde_json::Value, String> {
    println!("[Fabric] Installing Fabric {} for MC {}", loader_version, mc_version);
    
    let app_state = state.lock().await;
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    drop(app_state);
    
    let mc_path = Path::new(&mc_dir);
    let versions_dir = mc_path.join("versions");
    
    let client = reqwest::Client::new();
    
    // 获取 Fabric 版本 JSON
    send_progress(&app_handle, 10, "获取 Fabric 配置...", "");
    
    let fabric_json_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        mc_version, loader_version
    );
    
    let fabric_json: serde_json::Value = client
        .get(&fabric_json_url)
        .send()
        .await
        .map_err(|e| format!("获取 Fabric 配置失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析 Fabric 配置失败: {}", e))?;
    
    // 版本 ID
    let version_id = fabric_json["id"].as_str()
        .ok_or("无效的 Fabric 配置")?
        .to_string();
    
    let version_dir = versions_dir.join(&version_id);
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    
    // 保存版本 JSON
    send_progress(&app_handle, 30, "保存版本配置...", "");
    
    let json_path = version_dir.join(format!("{}.json", version_id));
    let json_content = serde_json::to_string_pretty(&fabric_json).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, json_content).map_err(|e| e.to_string())?;
    
    // 下载 Fabric 库
    send_progress(&app_handle, 50, "下载 Fabric 库...", "");
    
    let libraries_dir = mc_path.join("libraries");
    
    if let Some(libraries) = fabric_json["libraries"].as_array() {
        let total = libraries.len();
        for (i, lib) in libraries.iter().enumerate() {
            if let Some(name) = lib["name"].as_str() {
                let url = lib["url"].as_str().unwrap_or("https://maven.fabricmc.net/");
                
                // 解析 Maven 坐标
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    let group = parts[0].replace('.', "/");
                    let artifact = parts[1];
                    let version = parts[2];
                    
                    let path = format!("{}/{}/{}/{}-{}.jar", group, artifact, version, artifact, version);
                    let lib_path = libraries_dir.join(&path);
                    
                    if !lib_path.exists() {
                        if let Some(parent) = lib_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }
                        
                        let download_url = format!("{}{}", url, path);
                        let progress = 50 + (i as f32 / total as f32 * 40.0) as u32;
                        send_progress(&app_handle, progress, "下载 Fabric 库...", &path);
                        
                        if let Err(e) = download_file(&client, &download_url, &lib_path).await {
                            println!("[Fabric] Failed to download {}: {}", path, e);
                        }
                    }
                }
            }
        }
    }
    
    send_progress(&app_handle, 100, "安装完成", "");
    
    Ok(serde_json::json!({
        "success": true,
        "versionId": version_id
    }))
}

// 安装 Forge
#[tauri::command]
pub async fn install_forge(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
    mc_version: String,
    forge_version: String,
) -> Result<serde_json::Value, String> {
    println!("[Forge] Installing Forge {} for MC {}", forge_version, mc_version);
    
    let app_state = state.lock().await;
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    drop(app_state);
    
    let mc_path = Path::new(&mc_dir);
    let versions_dir = mc_path.join("versions");
    
    let client = reqwest::Client::new();
    
    // 使用 BMCLAPI 获取 Forge 安装信息
    send_progress(&app_handle, 10, "获取 Forge 配置...", "");
    
    // 获取 Forge 版本详情
    let forge_list_url = format!(
        "https://bmclapi2.bangbang93.com/forge/minecraft/{}",
        mc_version
    );
    
    let forge_list: Vec<serde_json::Value> = client
        .get(&forge_list_url)
        .send()
        .await
        .map_err(|e| format!("获取 Forge 列表失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析 Forge 列表失败: {}", e))?;
    
    // 找到对应版本
    let forge_info = forge_list.iter()
        .find(|f| f["version"].as_str() == Some(&forge_version))
        .ok_or("未找到指定的 Forge 版本")?;
    
    let build = forge_info["build"].as_i64().ok_or("无效的 Forge 构建号")?;
    
    // 获取安装配置
    let install_url = format!(
        "https://bmclapi2.bangbang93.com/forge/download/{}",
        build
    );
    
    send_progress(&app_handle, 30, "下载 Forge 安装器...", "");
    
    // 下载 Forge 安装器到临时目录
    let temp_dir = std::env::temp_dir().join("imagine_launcher");
    std::fs::create_dir_all(&temp_dir).ok();
    
    let installer_path = temp_dir.join(format!("forge-{}-{}-installer.jar", mc_version, forge_version));
    download_file(&client, &install_url, &installer_path).await?;
    
    // 版本 ID
    let version_id = format!("{}-forge-{}", mc_version, forge_version);
    let version_dir = versions_dir.join(&version_id);
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    
    send_progress(&app_handle, 60, "解压 Forge 文件...", "");
    
    // 解压安装器获取版本 JSON
    let file = std::fs::File::open(&installer_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    
    // 查找版本 JSON
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        
        if name == "version.json" || name.ends_with("/version.json") {
            let mut content = String::new();
            std::io::Read::read_to_string(&mut file, &mut content).map_err(|e| e.to_string())?;
            
            // 修改版本 ID
            let mut json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            json["id"] = serde_json::Value::String(version_id.clone());
            
            let json_path = version_dir.join(format!("{}.json", version_id));
            let json_content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
            std::fs::write(&json_path, json_content).map_err(|e| e.to_string())?;
            
            break;
        }
    }
    
    // 清理临时文件
    std::fs::remove_file(&installer_path).ok();
    
    send_progress(&app_handle, 100, "安装完成", "");
    
    Ok(serde_json::json!({
        "success": true,
        "versionId": version_id
    }))
}

// 安装 Quilt
#[tauri::command]
pub async fn install_quilt(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
    mc_version: String,
    loader_version: String,
) -> Result<serde_json::Value, String> {
    println!("[Quilt] Installing Quilt {} for MC {}", loader_version, mc_version);
    
    let app_state = state.lock().await;
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    drop(app_state);
    
    let mc_path = Path::new(&mc_dir);
    let versions_dir = mc_path.join("versions");
    
    let client = reqwest::Client::new();
    
    // 获取 Quilt 版本 JSON
    send_progress(&app_handle, 10, "获取 Quilt 配置...", "");
    
    let quilt_json_url = format!(
        "https://meta.quiltmc.org/v3/versions/loader/{}/{}/profile/json",
        mc_version, loader_version
    );
    
    let quilt_json: serde_json::Value = client
        .get(&quilt_json_url)
        .send()
        .await
        .map_err(|e| format!("获取 Quilt 配置失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析 Quilt 配置失败: {}", e))?;
    
    // 版本 ID
    let version_id = quilt_json["id"].as_str()
        .ok_or("无效的 Quilt 配置")?
        .to_string();
    
    let version_dir = versions_dir.join(&version_id);
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    
    // 保存版本 JSON
    send_progress(&app_handle, 30, "保存版本配置...", "");
    
    let json_path = version_dir.join(format!("{}.json", version_id));
    let json_content = serde_json::to_string_pretty(&quilt_json).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, json_content).map_err(|e| e.to_string())?;
    
    // 下载 Quilt 库
    send_progress(&app_handle, 50, "下载 Quilt 库...", "");
    
    let libraries_dir = mc_path.join("libraries");
    
    if let Some(libraries) = quilt_json["libraries"].as_array() {
        let total = libraries.len();
        for (i, lib) in libraries.iter().enumerate() {
            if let Some(name) = lib["name"].as_str() {
                let url = lib["url"].as_str().unwrap_or("https://maven.quiltmc.org/repository/release/");
                
                // 解析 Maven 坐标
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    let group = parts[0].replace('.', "/");
                    let artifact = parts[1];
                    let version = parts[2];
                    
                    let path = format!("{}/{}/{}/{}-{}.jar", group, artifact, version, artifact, version);
                    let lib_path = libraries_dir.join(&path);
                    
                    if !lib_path.exists() {
                        if let Some(parent) = lib_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }
                        
                        let download_url = format!("{}{}", url, path);
                        let progress = 50 + (i as f32 / total as f32 * 40.0) as u32;
                        send_progress(&app_handle, progress, "下载 Quilt 库...", &path);
                        
                        if let Err(e) = download_file(&client, &download_url, &lib_path).await {
                            println!("[Quilt] Failed to download {}: {}", path, e);
                        }
                    }
                }
            }
        }
    }
    
    send_progress(&app_handle, 100, "安装完成", "");
    
    Ok(serde_json::json!({
        "success": true,
        "versionId": version_id
    }))
}

// 打开 URL
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

// 获取 Forge 支持的 MC 版本列表 (代理 API 避免 CORS)
#[tauri::command]
pub async fn get_forge_mc_versions() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://bmclapi2.bangbang93.com/forge/minecraft")
        .send()
        .await
        .map_err(|e| format!("获取 Forge 版本列表失败: {}", e))?;
    
    let versions: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析 Forge 版本列表失败: {}", e))?;
    
    Ok(versions)
}

// 获取指定 MC 版本的 Forge 版本列表 (代理 API 避免 CORS)
#[tauri::command]
pub async fn get_forge_versions(mc_version: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("https://bmclapi2.bangbang93.com/forge/minecraft/{}", mc_version);
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("获取 Forge 版本失败: {}", e))?;
    
    let versions: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析 Forge 版本失败: {}", e))?;
    
    Ok(versions)
}

// 辅助函数
fn send_progress(app_handle: &tauri::AppHandle, percent: u32, status: &str, file: &str) {
    let _ = app_handle.emit("download-progress", serde_json::json!({
        "percent": percent,
        "status": status,
        "file": file
    }));
}

async fn download_file(client: &reqwest::Client, url: &str, path: &Path) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(path, &bytes).map_err(|e| e.to_string())?;
    
    Ok(())
}

fn check_library_rules(rules: &Option<Vec<serde_json::Value>>) -> bool {
    let rules = match rules {
        Some(r) => r,
        None => return true,
    };
    
    if rules.is_empty() {
        return true;
    }
    
    let current_os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };
    
    let mut result = false;
    
    for rule in rules {
        let action = rule["action"].as_str().unwrap_or("allow") == "allow";
        let mut matches = true;
        
        if let Some(os) = rule.get("os") {
            if let Some(name) = os["name"].as_str() {
                if name != current_os {
                    matches = false;
                }
            }
        }
        
        if matches {
            result = action;
        }
    }
    
    result
}


// ═══════════════════════════════════════════════════════════
// 自动补全游戏文件 (类似 HMCL 的 checkGameCompletionAsync)
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Serialize)]
pub struct CompletionResult {
    pub success: bool,
    pub missing_files: Vec<String>,
    pub downloaded_files: Vec<String>,
    pub failed_files: Vec<String>,
}

/// 检查并补全游戏文件（参考 HMCL 的 checkGameCompletionAsync）
/// 包括：版本JAR、库文件、资源文件
/// 使用 SHA-1 校验文件完整性
#[tauri::command]
pub async fn complete_game_files(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
    version_id: String,
) -> Result<serde_json::Value, String> {
    println!("[Complete] Checking game files for version: {}", version_id);
    
    let app_state = state.lock().await;
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    let auto_complete_enabled = app_state.launcher_settings.version_settings
        .get(&version_id)
        .map(|vs| vs.auto_complete_files.unwrap_or(true))
        .unwrap_or(true);
    
    drop(app_state);
    
    if !auto_complete_enabled {
        return Ok(serde_json::json!({ "success": true, "skipped": true }));
    }
    
    let mc_path = Path::new(&mc_dir);
    let versions_dir = mc_path.join("versions");
    let version_dir = versions_dir.join(&version_id);
    let libraries_dir = mc_path.join("libraries");
    let assets_dir = mc_path.join("assets");
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    
    let mut downloaded_count = 0;
    let mut failed_count = 0;
    
    // 1. 读取并合并版本 JSON
    let json_path = version_dir.join(format!("{}.json", version_id));
    if !json_path.exists() {
        return Err(format!("版本文件不存在: {}", json_path.display()));
    }
    
    let json_content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let version_json: serde_json::Value = serde_json::from_str(&json_content).map_err(|e| e.to_string())?;
    let merged = merge_version_json(&mc_dir, &version_json)?;
    
    // 2. 检查版本 JAR（带 SHA-1 校验）
    send_progress(&app_handle, 5, "检查游戏客户端...", "");
    
    let jar_path = version_dir.join(format!("{}.jar", version_id));
    let expected_sha1 = merged.pointer("/downloads/client/sha1").and_then(|v| v.as_str());
    let jar_url = merged.pointer("/downloads/client/url").and_then(|v| v.as_str());
    
    let need_download_jar = if !jar_path.exists() {
        true
    } else if let Some(sha1) = expected_sha1 {
        !verify_sha1(&jar_path, sha1)
    } else {
        std::fs::metadata(&jar_path).map(|m| m.len() == 0).unwrap_or(true)
    };
    
    if need_download_jar {
        // 尝试从父版本复制
        if let Some(inherits) = merged["inheritsFrom"].as_str() {
            let parent_jar = versions_dir.join(inherits).join(format!("{}.jar", inherits));
            if parent_jar.exists() {
                std::fs::copy(&parent_jar, &jar_path).ok();
                downloaded_count += 1;
            }
        }
        // 如果还需要下载
        if !jar_path.exists() || (expected_sha1.is_some() && !verify_sha1(&jar_path, expected_sha1.unwrap())) {
            if let Some(url) = jar_url {
                match download_file(&client, url, &jar_path).await {
                    Ok(_) => downloaded_count += 1,
                    Err(e) => { println!("[Complete] JAR download failed: {}", e); failed_count += 1; }
                }
            }
        }
    }
    
    // 3. 检查库文件（带 SHA-1 校验）
    send_progress(&app_handle, 15, "检查依赖库...", "");
    
    if let Some(libraries) = merged["libraries"].as_array() {
        let total = libraries.len();
        for (i, lib) in libraries.iter().enumerate() {
            if !check_library_rules(&lib.get("rules").cloned().and_then(|v| serde_json::from_value(v).ok())) {
                continue;
            }
            if lib.get("natives").is_some() { continue; }
            
            let (lib_path, lib_url, lib_sha1) = if let Some(artifact) = lib.pointer("/downloads/artifact") {
                let path = artifact["path"].as_str();
                let url = artifact["url"].as_str();
                let sha1 = artifact["sha1"].as_str();
                if let (Some(p), Some(u)) = (path, url) {
                    (libraries_dir.join(p), u.to_string(), sha1.map(|s| s.to_string()))
                } else { continue; }
            } else if let Some(name) = lib["name"].as_str() {
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() < 3 { continue; }
                let group = parts[0].replace('.', "/");
                let artifact = parts[1];
                let version = parts[2];
                let path = format!("{}/{}/{}/{}-{}.jar", group, artifact, version, artifact, version);
                let base_url = lib["url"].as_str().unwrap_or("https://libraries.minecraft.net/");
                (libraries_dir.join(&path), format!("{}{}", base_url, path), None)
            } else { continue; };
            
            // 检查是否需要下载（不存在或 SHA-1 不匹配）
            let need_download = if !lib_path.exists() {
                true
            } else if let Some(ref sha1) = lib_sha1 {
                !verify_sha1(&lib_path, sha1)
            } else {
                false
            };
            
            if need_download {
                if let Some(parent) = lib_path.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                let progress = 15 + (i as f32 / total as f32 * 35.0) as u32;
                let file_name = lib_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                send_progress(&app_handle, progress, "下载依赖库...", file_name);
                
                match download_file(&client, &lib_url, &lib_path).await {
                    Ok(_) => downloaded_count += 1,
                    Err(e) => { println!("[Complete] Library failed: {}", e); failed_count += 1; }
                }
            }
        }
    }
    
    // 4. 检查资源索引
    send_progress(&app_handle, 55, "检查资源索引...", "");
    
    let indexes_dir = assets_dir.join("indexes");
    std::fs::create_dir_all(&indexes_dir).ok();
    
    if let Some(asset_index) = merged.get("assetIndex") {
        let index_id = asset_index["id"].as_str().unwrap_or("legacy");
        let index_url = asset_index["url"].as_str();
        let index_sha1 = asset_index["sha1"].as_str();
        let index_path = indexes_dir.join(format!("{}.json", index_id));
        
        let need_index = if !index_path.exists() {
            true
        } else if let Some(sha1) = index_sha1 {
            !verify_sha1(&index_path, sha1)
        } else { false };
        
        if need_index {
            if let Some(url) = index_url {
                match download_file(&client, url, &index_path).await {
                    Ok(_) => downloaded_count += 1,
                    Err(e) => { println!("[Complete] Index failed: {}", e); failed_count += 1; }
                }
            }
        }
        
        // 5. 检查资源文件（全部下载，带 SHA-1 校验）
        send_progress(&app_handle, 60, "检查资源文件...", "");
        
        if index_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&index_path) {
                if let Ok(index_json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let objects_dir = assets_dir.join("objects");
                    std::fs::create_dir_all(&objects_dir).ok();
                    
                    if let Some(objects) = index_json["objects"].as_object() {
                        let mut to_download: Vec<(String, String)> = Vec::new();
                        
                        for (name, info) in objects {
                            if let Some(hash) = info["hash"].as_str() {
                                let prefix = &hash[0..2];
                                let asset_path = objects_dir.join(prefix).join(hash);
                                
                                // 检查文件是否存在且 SHA-1 正确
                                let need = if !asset_path.exists() {
                                    true
                                } else {
                                    !verify_sha1(&asset_path, hash)
                                };
                                
                                if need {
                                    to_download.push((hash.to_string(), name.clone()));
                                }
                            }
                        }
                        
                        let total = to_download.len();
                        println!("[Complete] Need to download {} asset files", total);
                        
                        for (i, (hash, name)) in to_download.iter().enumerate() {
                            let prefix = &hash[0..2];
                            let url = format!("https://resources.download.minecraft.net/{}/{}", prefix, hash);
                            let asset_path = objects_dir.join(prefix).join(hash);
                            
                            if let Some(parent) = asset_path.parent() {
                                std::fs::create_dir_all(parent).ok();
                            }
                            
                            let progress = 60 + (i as f32 / total.max(1) as f32 * 35.0) as u32;
                            if i % 50 == 0 {
                                send_progress(&app_handle, progress, &format!("下载资源 ({}/{})", i, total), name);
                            }
                            
                            match download_file(&client, &url, &asset_path).await {
                                Ok(_) => downloaded_count += 1,
                                Err(_) => failed_count += 1,
                            }
                        }
                    }
                }
            }
        }
    }
    
    send_progress(&app_handle, 100, "补全完成", "");
    
    println!("[Complete] Done: downloaded={}, failed={}", downloaded_count, failed_count);
    
    Ok(serde_json::json!({
        "success": failed_count == 0,
        "downloadedFiles": downloaded_count,
        "failedFiles": failed_count
    }))
}

/// 验证文件 SHA-1
fn verify_sha1(path: &Path, expected: &str) -> bool {
    use sha1::{Sha1, Digest};
    
    match std::fs::read(path) {
        Ok(data) => {
            let mut hasher = Sha1::new();
            hasher.update(&data);
            let result = hasher.finalize();
            let hash = format!("{:x}", result);
            hash == expected.to_lowercase()
        }
        Err(_) => false
    }
}

/// 合并版本 JSON 继承链
fn merge_version_json(mc_dir: &str, version_json: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut merged = version_json.clone();
    
    // 处理继承
    if let Some(inherits_from) = version_json["inheritsFrom"].as_str() {
        let parent_path = Path::new(mc_dir)
            .join("versions")
            .join(inherits_from)
            .join(format!("{}.json", inherits_from));
        
        if parent_path.exists() {
            let parent_content = std::fs::read_to_string(&parent_path).map_err(|e| e.to_string())?;
            let parent_json: serde_json::Value = serde_json::from_str(&parent_content).map_err(|e| e.to_string())?;
            
            // 递归合并父版本
            let parent_merged = merge_version_json(mc_dir, &parent_json)?;
            
            // 合并库
            if let (Some(parent_libs), Some(child_libs)) = (
                parent_merged["libraries"].as_array(),
                merged["libraries"].as_array_mut()
            ) {
                let mut all_libs = parent_libs.clone();
                all_libs.extend(child_libs.iter().cloned());
                merged["libraries"] = serde_json::Value::Array(all_libs);
            } else if let Some(parent_libs) = parent_merged["libraries"].as_array() {
                merged["libraries"] = serde_json::Value::Array(parent_libs.clone());
            }
            
            // 合并其他字段
            if merged.get("downloads").is_none() {
                if let Some(downloads) = parent_merged.get("downloads") {
                    merged["downloads"] = downloads.clone();
                }
            }
            if merged.get("assetIndex").is_none() {
                if let Some(asset_index) = parent_merged.get("assetIndex") {
                    merged["assetIndex"] = asset_index.clone();
                }
            }
            if merged.get("assets").is_none() {
                if let Some(assets) = parent_merged.get("assets") {
                    merged["assets"] = assets.clone();
                }
            }
            if merged.get("mainClass").is_none() {
                if let Some(main_class) = parent_merged.get("mainClass") {
                    merged["mainClass"] = main_class.clone();
                }
            }
        }
    }
    
    Ok(merged)
}
