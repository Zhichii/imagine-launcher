// Mods Management Module
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use zip::ZipArchive;
use crate::launcher::get_default_mc_dir;
use crate::state::AppState;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModInfo {
    pub name: String,
    pub id: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Option<String>,
    pub loader: Option<String>,
    #[serde(rename = "mcVersion")]
    pub mc_version: Option<String>,
    pub file: String,
    pub size: u64,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptiFineVersion {
    pub game_version: String,
    pub version: String,
    pub r#type: String,
    pub patch: String,
    pub date: String,
    pub download_url: String,
    pub is_preview: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct BMCLOptiFineVersion {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "mcversion")]
    pub game_version: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub patch: String,
    #[serde(rename = "__v")]
    pub version_num: Option<i32>,
    pub filename: String,
    #[serde(default)]
    pub forge: Option<String>,
}

#[tauri::command]
pub async fn scan_mods(mods_dir: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&mods_dir);
    
    if !path.exists() {
        return Ok(serde_json::json!({
            "success": true,
            "mods": []
        }));
    }
    
    let mut mods = Vec::new();
    
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    
    for entry in entries.flatten() {
        let file_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        // 检查是否是 jar 文件
        let is_jar = file_name.ends_with(".jar");
        let is_disabled = file_name.ends_with(".jar.disabled");
        
        if !is_jar && !is_disabled {
            continue;
        }
        
        let metadata = entry.metadata().ok();
        let size = metadata.map(|m| m.len()).unwrap_or(0);
        
        // 尝试读取 mod 信息
        let mod_info = read_mod_info(&file_path).unwrap_or_else(|| {
            // 从文件名推断名称
            let name = file_name
                .trim_end_matches(".disabled")
                .trim_end_matches(".jar")
                .to_string();
            ModInfo {
                name,
                id: None,
                version: None,
                description: None,
                authors: None,
                loader: None,
                mc_version: None,
                file: file_name.clone(),
                size,
                enabled: is_jar,
            }
        });
        
        mods.push(ModInfo {
            file: file_name,
            size,
            enabled: is_jar,
            ..mod_info
        });
    }
    
    // 按名称排序
    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    
    Ok(serde_json::json!({
        "success": true,
        "mods": mods
    }))
}

fn read_mod_info(path: &Path) -> Option<ModInfo> {
    let file = fs::File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;
    
    // 尝试读取 Fabric mod (fabric.mod.json)
    if let Ok(mut fabric_json) = archive.by_name("fabric.mod.json") {
        let mut content = String::new();
        std::io::Read::read_to_string(&mut fabric_json, &mut content).ok()?;
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            return Some(ModInfo {
                name: json["name"].as_str().unwrap_or("Unknown").to_string(),
                id: json["id"].as_str().map(|s| s.to_string()),
                version: json["version"].as_str().map(|s| s.to_string()),
                description: json["description"].as_str().map(|s| s.to_string()),
                authors: json["authors"].as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|v| {
                            if let Some(s) = v.as_str() {
                                Some(s.to_string())
                            } else if let Some(obj) = v.as_object() {
                                obj.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                }),
                loader: Some("Fabric".to_string()),
                mc_version: json["depends"]["minecraft"].as_str().map(|s| s.to_string()),
                file: String::new(),
                size: 0,
                enabled: true,
            });
        }
    }
    
    // 尝试读取 Quilt mod (quilt.mod.json)
    if let Ok(mut quilt_json) = archive.by_name("quilt.mod.json") {
        let mut content = String::new();
        std::io::Read::read_to_string(&mut quilt_json, &mut content).ok()?;
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let loader = &json["quilt_loader"];
            return Some(ModInfo {
                name: loader["metadata"]["name"].as_str()
                    .or_else(|| loader["id"].as_str())
                    .unwrap_or("Unknown").to_string(),
                id: loader["id"].as_str().map(|s| s.to_string()),
                version: loader["version"].as_str().map(|s| s.to_string()),
                description: loader["metadata"]["description"].as_str().map(|s| s.to_string()),
                authors: None,
                loader: Some("Quilt".to_string()),
                mc_version: None,
                file: String::new(),
                size: 0,
                enabled: true,
            });
        }
    }
    
    // 尝试读取 Forge mod (META-INF/mods.toml 或 mcmod.info)
    if let Ok(mut mods_toml) = archive.by_name("META-INF/mods.toml") {
        let mut content = String::new();
        std::io::Read::read_to_string(&mut mods_toml, &mut content).ok()?;
        // 简单解析 TOML
        let name = extract_toml_value(&content, "displayName")
            .or_else(|| extract_toml_value(&content, "modId"));
        let version = extract_toml_value(&content, "version");
        let description = extract_toml_value(&content, "description");
        let mod_id = extract_toml_value(&content, "modId");
        let authors = extract_toml_value(&content, "authors");
        
        if name.is_some() || mod_id.is_some() {
            return Some(ModInfo {
                name: name.unwrap_or_else(|| mod_id.clone().unwrap_or_default()),
                id: mod_id,
                version,
                description,
                authors,
                loader: Some("Forge".to_string()),
                mc_version: None,
                file: String::new(),
                size: 0,
                enabled: true,
            });
        }
    }
    
    // 尝试读取旧版 Forge mod (mcmod.info)
    if let Ok(mut mcmod_info) = archive.by_name("mcmod.info") {
        let mut content = String::new();
        std::io::Read::read_to_string(&mut mcmod_info, &mut content).ok()?;
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let mod_info = if json.is_array() {
                json.as_array()?.first()?
            } else {
                &json
            };
            
            return Some(ModInfo {
                name: mod_info["name"].as_str().unwrap_or("Unknown").to_string(),
                id: mod_info["modid"].as_str().map(|s| s.to_string()),
                version: mod_info["version"].as_str().map(|s| s.to_string()),
                description: mod_info["description"].as_str().map(|s| s.to_string()),
                authors: mod_info["authorList"].as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                }),
                loader: Some("Forge".to_string()),
                mc_version: mod_info["mcversion"].as_str().map(|s| s.to_string()),
                file: String::new(),
                size: 0,
                enabled: true,
            });
        }
    }
    
    None
}

fn extract_toml_value(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with(key) {
            if let Some(pos) = line.find('=') {
                let value = line[pos + 1..].trim();
                // 移除引号
                let value = value.trim_matches('"').trim_matches('\'');
                if !value.is_empty() && value != "${file.jarVersion}" {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn toggle_mod(
    mods_dir: String,
    file: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let path = Path::new(&mods_dir).join(&file);
    
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    
    let new_file = if enabled {
        // 启用: 移除 .disabled 后缀
        file.trim_end_matches(".disabled").to_string()
    } else {
        // 禁用: 添加 .disabled 后缀
        if file.ends_with(".disabled") {
            file.clone()
        } else {
            format!("{}.disabled", file)
        }
    };
    
    let new_path = Path::new(&mods_dir).join(&new_file);
    
    if path != new_path {
        fs::rename(&path, &new_path).map_err(|e| e.to_string())?;
    }
    
    Ok(serde_json::json!({
        "success": true,
        "newFile": new_file
    }))
}

#[tauri::command]
pub async fn delete_mod(mods_dir: String, file: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&mods_dir).join(&file);
    
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true
    }))
}

#[tauri::command]
pub async fn add_mod(mods_dir: String) -> Result<serde_json::Value, String> {
    // 确保目录存在
    let path = Path::new(&mods_dir);
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }
    
    // 这里需要通过前端调用文件选择对话框
    // 返回需要前端处理的标记
    Ok(serde_json::json!({
        "success": false,
        "needFileDialog": true,
        "modsDir": mods_dir
    }))
}

#[tauri::command]
pub async fn copy_mod_to_dir(
    source_path: String,
    mods_dir: String,
) -> Result<serde_json::Value, String> {
    let source = Path::new(&source_path);
    
    if !source.exists() {
        return Err("源文件不存在".to_string());
    }
    
    let file_name = source.file_name()
        .ok_or("无效的文件名")?
        .to_string_lossy()
        .to_string();
    
    let dest_dir = Path::new(&mods_dir);
    if !dest_dir.exists() {
        fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    }
    
    let dest = dest_dir.join(&file_name);
    fs::copy(source, &dest).map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "file": file_name
    }))
}

#[tauri::command]
pub async fn open_folder(folder_path: String) -> Result<(), String> {
    let path = Path::new(&folder_path);
    
    // 如果目录不存在，创建它
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }
    
    open::that(path).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorldInfo {
    pub name: String,
    pub folder: String,
    pub icon: Option<String>,
    #[serde(rename = "gameMode")]
    pub game_mode: Option<String>,
    #[serde(rename = "lastPlayed")]
    pub last_played: Option<i64>,
    pub size: Option<u64>,
}

#[tauri::command]
pub async fn scan_worlds(saves_dir: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&saves_dir);
    
    if !path.exists() {
        return Ok(serde_json::json!({
            "success": true,
            "worlds": []
        }));
    }
    
    let mut worlds = Vec::new();
    
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    
    for entry in entries.flatten() {
        let entry_path = entry.path();
        
        if !entry_path.is_dir() {
            continue;
        }
        
        let folder_name = entry.file_name().to_string_lossy().to_string();
        
        // 检查是否是有效的存档目录（包含 level.dat）
        let level_dat = entry_path.join("level.dat");
        if !level_dat.exists() {
            continue;
        }
        
        // 尝试读取存档信息
        let world_name = folder_name.clone();
        let game_mode = None;
        let mut last_played = None;
        
        // 尝试读取 level.dat（NBT 格式，这里简化处理）
        // 实际上需要 NBT 解析库，这里只用文件夹名
        
        // 计算目录大小
        let size = calculate_dir_size(&entry_path).ok();
        
        // 检查是否有图标
        let icon_path = entry_path.join("icon.png");
        let icon = if icon_path.exists() {
            Some(icon_path.to_string_lossy().to_string())
        } else {
            None
        };
        
        // 获取最后修改时间
        if let Ok(metadata) = level_dat.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                    last_played = Some(duration.as_millis() as i64);
                }
            }
        }
        
        worlds.push(WorldInfo {
            name: world_name,
            folder: folder_name,
            icon,
            game_mode,
            last_played,
            size,
        });
    }
    
    // 按最后游玩时间排序
    worlds.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    
    Ok(serde_json::json!({
        "success": true,
        "worlds": worlds
    }))
}

fn calculate_dir_size(path: &Path) -> Result<u64, std::io::Error> {
    let mut size = 0;
    
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            
            if entry_path.is_dir() {
                size += calculate_dir_size(&entry_path)?;
            } else {
                size += entry.metadata()?.len();
            }
        }
    }
    
    Ok(size)
}

#[tauri::command]
pub async fn delete_world(saves_dir: String, folder: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&saves_dir).join(&folder);
    
    if !path.exists() {
        return Err("存档不存在".to_string());
    }
    
    fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true
    }))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourcepackInfo {
    pub name: String,
    pub file: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub size: u64,
}

#[tauri::command]
pub async fn scan_resourcepacks(resourcepacks_dir: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&resourcepacks_dir);
    
    if !path.exists() {
        return Ok(serde_json::json!({
            "success": true,
            "resourcepacks": []
        }));
    }
    
    let mut resourcepacks = Vec::new();
    
    // 创建缓存目录用于存储提取的图标
    let cache_dir = Path::new(&resourcepacks_dir).join(".pack_icons");
    let _ = fs::create_dir_all(&cache_dir);
    
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    
    for entry in entries.flatten() {
        let file_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        
        // 跳过缓存目录
        if file_name == ".pack_icons" {
            continue;
        }
        
        // 检查是否是 zip 文件或目录
        let is_zip = file_name.ends_with(".zip");
        let is_dir = file_path.is_dir();
        
        if !is_zip && !is_dir {
            continue;
        }
        
        let metadata = entry.metadata().ok();
        let size = if is_dir {
            calculate_dir_size(&file_path).unwrap_or(0)
        } else {
            metadata.map(|m| m.len()).unwrap_or(0)
        };
        
        // 尝试读取资源包信息和图标
        let (pack_info, icon_path) = read_resourcepack_info_with_icon(&file_path, &cache_dir);
        
        resourcepacks.push(ResourcepackInfo {
            name: pack_info.as_ref().map(|p| p.0.clone()).unwrap_or_else(|| {
                file_name.trim_end_matches(".zip").to_string()
            }),
            file: file_name,
            description: pack_info.as_ref().and_then(|p| p.1.clone()),
            icon: icon_path,
            size,
        });
    }
    
    // 按名称排序
    resourcepacks.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    
    Ok(serde_json::json!({
        "success": true,
        "resourcepacks": resourcepacks
    }))
}

fn read_resourcepack_info_with_icon(path: &Path, cache_dir: &Path) -> (Option<(String, Option<String>)>, Option<String>) {
    let file_stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let icon_cache_path = cache_dir.join(format!("{}.png", file_stem));
    
    if path.is_dir() {
        // 目录形式的资源包
        let pack_mcmeta = path.join("pack.mcmeta");
        let pack_png = path.join("pack.png");
        
        let mut info = None;
        if pack_mcmeta.exists() {
            if let Ok(content) = fs::read_to_string(&pack_mcmeta) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    // 处理描述，可能是字符串或对象
                    let description = if let Some(desc) = json["pack"]["description"].as_str() {
                        Some(desc.to_string())
                    } else if let Some(desc_obj) = json["pack"]["description"].as_object() {
                        // JSON 文本组件格式
                        desc_obj.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    };
                    info = Some((path.file_name().unwrap_or_default().to_string_lossy().to_string(), description));
                }
            }
        }
        
        let icon = if pack_png.exists() {
            Some(pack_png.to_string_lossy().to_string())
        } else {
            None
        };
        
        (info, icon)
    } else {
        // ZIP 形式的资源包
        if let Ok(file) = fs::File::open(path) {
            if let Ok(mut archive) = ZipArchive::new(file) {
                let mut info = None;
                
                // 读取 pack.mcmeta
                if let Ok(mut pack_mcmeta) = archive.by_name("pack.mcmeta") {
                    let mut content = String::new();
                    if std::io::Read::read_to_string(&mut pack_mcmeta, &mut content).is_ok() {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            let description = if let Some(desc) = json["pack"]["description"].as_str() {
                                Some(desc.to_string())
                            } else if let Some(desc_obj) = json["pack"]["description"].as_object() {
                                desc_obj.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                            } else {
                                None
                            };
                            let name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                            info = Some((name, description));
                        }
                    }
                }
                
                // 提取 pack.png 图标
                let icon = if !icon_cache_path.exists() {
                    // 重新打开文件以提取图标
                    if let Ok(file2) = fs::File::open(path) {
                        if let Ok(mut archive2) = ZipArchive::new(file2) {
                            if let Ok(mut pack_png) = archive2.by_name("pack.png") {
                                let mut icon_data = Vec::new();
                                if std::io::Read::read_to_end(&mut pack_png, &mut icon_data).is_ok() {
                                    if fs::write(&icon_cache_path, &icon_data).is_ok() {
                                        Some(icon_cache_path.to_string_lossy().to_string())
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    Some(icon_cache_path.to_string_lossy().to_string())
                };
                
                return (info, icon);
            }
        }
        (None, None)
    }
}

fn read_resourcepack_info(path: &Path) -> Option<(String, Option<String>)> {
    read_resourcepack_info_with_icon(path, Path::new("")).0
}

#[tauri::command]
pub async fn delete_file(file_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&file_path);
    
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    
    Ok(serde_json::json!({
        "success": true
    }))
}

#[tauri::command]
pub async fn copy_file_to_dir(
    source_path: String,
    dest_dir: String,
) -> Result<serde_json::Value, String> {
    let source = Path::new(&source_path);
    
    if !source.exists() {
        return Err("源文件不存在".to_string());
    }
    
    let file_name = source.file_name()
        .ok_or("无效的文件名")?
        .to_string_lossy()
        .to_string();
    
    let dest_dir_path = Path::new(&dest_dir);
    if !dest_dir_path.exists() {
        fs::create_dir_all(dest_dir_path).map_err(|e| e.to_string())?;
    }
    
    let dest = dest_dir_path.join(&file_name);
    fs::copy(source, &dest).map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "file": file_name
    }))
}

// ==================== OptiFine 相关功能 ====================

#[tauri::command]
pub async fn get_optifine_versions(
    game_version: Option<String>,
) -> Result<serde_json::Value, String> {
    // 尝试多个 API 端点
    let api_urls = vec![
        "https://bmclapi2.bangbang93.com/optifine/versionlist",
        // 备用 API 可以在这里添加
    ];
    
    let mut last_error = String::new();
    
    for api_url in api_urls {
        println!("[OptiFine] Trying API: {}", api_url);
        
        match try_get_optifine_versions_from_api(api_url, &game_version).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                println!("[OptiFine] API {} failed: {}", api_url, e);
                last_error = e;
                continue;
            }
        }
    }
    
    Err(format!("所有 OptiFine API 都失败了，最后一个错误: {}", last_error))
}

async fn try_get_optifine_versions_from_api(
    api_url: &str,
    game_version: &Option<String>,
) -> Result<serde_json::Value, String> {
    
    let client = reqwest::Client::new();
    let response = client
        .get(api_url)
        .header("User-Agent", "ImagineLauncher/1.0.0")
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API 请求失败: {}", response.status()));
    }
    
    // 先获取响应文本进行调试
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    println!("[OptiFine] API Response length: {}", response_text.len());
    if response_text.len() > 0 {
        println!("[OptiFine] API Response preview: {}", &response_text[..std::cmp::min(500, response_text.len())]);
    }
    
    if response_text.trim().is_empty() {
        return Err("API 返回空响应".to_string());
    }
    
    // 尝试解析 JSON
    let bmcl_versions: Vec<BMCLOptiFineVersion> = serde_json::from_str(&response_text)
        .map_err(|e| {
            println!("[OptiFine] JSON parse error: {}", e);
            println!("[OptiFine] Raw response: {}", &response_text[..std::cmp::min(1000, response_text.len())]);
            format!("解析响应失败: {} - Response preview: {}", e, &response_text[..std::cmp::min(200, response_text.len())])
        })?;
    
    let mut versions: Vec<OptiFineVersion> = bmcl_versions
        .into_iter()
        .filter_map(|v| {
            // 如果指定了游戏版本，只返回匹配的版本
            if let Some(ref target_version) = game_version {
                if normalize_version(&v.game_version) != normalize_version(target_version) {
                    return None;
                }
            }
            
            let is_preview = v.patch.starts_with("pre") || v.patch.starts_with("alpha");
            let version_name = format!("{}_{}", v.r#type, v.patch);
            let download_url = format!(
                "https://bmclapi2.bangbang93.com/optifine/{}/{}/{}",
                lookup_version(&v.game_version),
                v.r#type,
                v.patch
            );
            
            Some(OptiFineVersion {
                game_version: normalize_version(&v.game_version),
                version: version_name,
                r#type: v.r#type,
                patch: v.patch,
                date: "Unknown".to_string(), // BMCLAPI 不提供日期信息
                download_url,
                is_preview,
            })
        })
        .collect();
    
    // 按版本号排序（因为没有日期信息）
    versions.sort_by(|a, b| {
        // 先按游戏版本排序
        let game_version_cmp = version_compare(&b.game_version, &a.game_version);
        if game_version_cmp != std::cmp::Ordering::Equal {
            return game_version_cmp;
        }
        
        // 再按 OptiFine 版本排序
        b.patch.cmp(&a.patch)
    });
    
    Ok(serde_json::json!({
        "success": true,
        "versions": versions
    }))
}

#[tauri::command]
pub async fn download_optifine(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    game_version: String,
    optifine_version: String,
    download_url: String,
) -> Result<serde_json::Value, String> {
    let app_state = state.lock().await;
    drop(app_state); // 释放锁
    
    // 创建临时下载目录
    let temp_dir = std::env::temp_dir().join("imaginelauncher_optifine");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    
    let installer_filename = format!("OptiFine_{}_{}.jar", 
        game_version, optifine_version);
    let installer_path = temp_dir.join(&installer_filename);
    
    // 下载 OptiFine 安装器
    println!("[OptiFine] Downloading from: {}", download_url);
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    
    let content = response
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    std::fs::write(&installer_path, content)
        .map_err(|e| format!("保存文件失败: {}", e))?;
    
    println!("[OptiFine] Downloaded to: {:?}", installer_path);
    
    Ok(serde_json::json!({
        "success": true,
        "installer_path": installer_path.to_string_lossy().to_string(),
        "filename": installer_filename
    }))
}

#[tauri::command]
pub async fn install_optifine(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    version_id: String,
    installer_path: String,
) -> Result<serde_json::Value, String> {
    let app_state = state.lock().await;
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    let installer = Path::new(&installer_path);
    if !installer.exists() {
        return Err("安装器文件不存在".to_string());
    }
    
    // 验证 OptiFine 安装器并提取版本信息
    let (mc_version, of_edition, of_release) = extract_optifine_info(installer)?;
    
    // 检查游戏版本是否匹配
    let version_dir = Path::new(&mc_dir).join("versions").join(&version_id);
    let version_json_path = version_dir.join(format!("{}.json", version_id));
    
    if !version_json_path.exists() {
        return Err("目标版本不存在".to_string());
    }
    
    // 读取版本 JSON 验证游戏版本
    let version_content = std::fs::read_to_string(&version_json_path)
        .map_err(|e| format!("读取版本文件失败: {}", e))?;
    let version_json: serde_json::Value = serde_json::from_str(&version_content)
        .map_err(|e| format!("解析版本文件失败: {}", e))?;
    
    // 获取实际的游戏版本
    let actual_game_version = if let Some(inherits) = version_json["inheritsFrom"].as_str() {
        inherits.to_string()
    } else {
        version_json["id"].as_str().unwrap_or(&version_id).to_string()
    };
    
    if normalize_version(&mc_version) != normalize_version(&actual_game_version) {
        return Err(format!(
            "版本不匹配: OptiFine 需要 {} 但目标版本是 {}",
            mc_version, actual_game_version
        ));
    }
    
    // 创建 OptiFine 版本
    let optifine_version_id = format!("{}-OptiFine_{}_{}_{}", 
        version_id, mc_version, of_edition, of_release);
    let optifine_version_dir = Path::new(&mc_dir).join("versions").join(&optifine_version_id);
    
    std::fs::create_dir_all(&optifine_version_dir)
        .map_err(|e| format!("创建版本目录失败: {}", e))?;
    
    // 复制 OptiFine 安装器到 libraries 目录
    let libraries_dir = Path::new(&mc_dir).join("libraries").join("optifine").join("OptiFine");
    let optifine_lib_version = format!("{}_{}_{}_{}", mc_version, of_edition, of_release, "installer");
    let optifine_lib_dir = libraries_dir.join(&optifine_lib_version);
    std::fs::create_dir_all(&optifine_lib_dir)
        .map_err(|e| format!("创建库目录失败: {}", e))?;
    
    let optifine_lib_path = optifine_lib_dir.join(format!("OptiFine-{}-installer.jar", optifine_lib_version));
    std::fs::copy(installer, &optifine_lib_path)
        .map_err(|e| format!("复制 OptiFine 库失败: {}", e))?;
    
    // 创建 OptiFine 版本 JSON
    let optifine_json = create_optifine_version_json(
        &optifine_version_id,
        &version_id,
        &mc_version,
        &of_edition,
        &of_release,
    );
    
    let optifine_json_path = optifine_version_dir.join(format!("{}.json", optifine_version_id));
    std::fs::write(&optifine_json_path, serde_json::to_string_pretty(&optifine_json).unwrap())
        .map_err(|e| format!("创建版本文件失败: {}", e))?;
    
    // 清理临时文件
    let _ = std::fs::remove_file(installer);
    
    println!("[OptiFine] Successfully installed OptiFine version: {}", optifine_version_id);
    
    Ok(serde_json::json!({
        "success": true,
        "version_id": optifine_version_id,
        "message": format!("OptiFine {} 安装成功", optifine_version_id)
    }))
}

// 辅助函数

fn normalize_version(version: &str) -> String {
    match version {
        "1.8.0" => "1.8".to_string(),
        "1.9.0" => "1.9".to_string(),
        _ => version.to_string(),
    }
}

fn lookup_version(version: &str) -> String {
    match version {
        "1.8" => "1.8.0".to_string(),
        "1.9" => "1.9.0".to_string(),
        _ => version.to_string(),
    }
}

fn extract_optifine_info(installer_path: &Path) -> Result<(String, String, String), String> {
    let file = std::fs::File::open(installer_path)
        .map_err(|e| format!("打开安装器失败: {}", e))?;
    
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("读取安装器失败: {}", e))?;
    
    // 查找 Config.class 文件
    let config_paths = [
        "Config.class",
        "net/optifine/Config.class", 
        "notch/net/optifine/Config.class"
    ];
    
    for config_path in &config_paths {
        if let Ok(mut config_file) = archive.by_name(config_path) {
            let mut content = Vec::new();
            std::io::Read::read_to_end(&mut config_file, &mut content)
                .map_err(|e| format!("读取 Config.class 失败: {}", e))?;
            
            // 简单的字符串搜索来提取版本信息
            let content_str = String::from_utf8_lossy(&content);
            
            let mc_version = extract_string_constant(&content_str, "MC_VERSION")
                .ok_or("无法提取 MC_VERSION")?;
            let of_edition = extract_string_constant(&content_str, "OF_EDITION")
                .ok_or("无法提取 OF_EDITION")?;
            let of_release = extract_string_constant(&content_str, "OF_RELEASE")
                .ok_or("无法提取 OF_RELEASE")?;
            
            return Ok((mc_version, of_edition, of_release));
        }
    }
    
    Err("无法找到 Config.class 文件".to_string())
}

fn extract_string_constant(content: &str, constant_name: &str) -> Option<String> {
    // 在字节码中查找字符串常量
    // 这是一个简化的实现，实际的字节码解析会更复杂
    if let Some(pos) = content.find(constant_name) {
        // 在常量名后查找可能的版本字符串
        let after_constant = &content[pos + constant_name.len()..];
        
        // 查找版本模式
        for line in after_constant.lines().take(10) {
            // 查找类似 "1.20.1" 的版本号
            if let Some(version) = extract_version_pattern(line) {
                return Some(version);
            }
        }
    }
    None
}

fn extract_version_pattern(text: &str) -> Option<String> {
    // 查找版本号模式
    let version_patterns = [
        r"\d+\.\d+\.\d+",  // 1.20.1
        r"\d+\.\d+",       // 1.20
        r"HD_U_[A-Z]\d+",  // HD_U_I5
        r"pre\d+",         // pre1
        r"alpha\d+",       // alpha1
    ];
    
    for pattern in &version_patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(mat) = re.find(text) {
                return Some(mat.as_str().to_string());
            }
        }
    }
    None
}

fn create_optifine_version_json(
    version_id: &str,
    base_version_id: &str,
    mc_version: &str,
    of_edition: &str,
    of_release: &str,
) -> serde_json::Value {
    let optifine_lib_version = format!("{}_{}_{}_{}", mc_version, of_edition, of_release, "installer");
    
    serde_json::json!({
        "id": version_id,
        "inheritsFrom": base_version_id,
        "type": "release",
        "time": chrono::Utc::now().to_rfc3339(),
        "releaseTime": chrono::Utc::now().to_rfc3339(),
        "mainClass": "net.minecraft.launchwrapper.Launch",
        "arguments": {
            "game": [
                "--tweakClass",
                "optifine.OptiFineTweaker"
            ]
        },
        "libraries": [
            {
                "name": format!("optifine:OptiFine:{}", optifine_lib_version),
                "downloads": {
                    "artifact": {
                        "path": format!("optifine/OptiFine/{}/OptiFine-{}-installer.jar", 
                            optifine_lib_version, optifine_lib_version),
                        "url": "",
                        "sha1": "",
                        "size": 0
                    }
                }
            },
            {
                "name": "net.minecraft:launchwrapper:1.12"
            }
        ]
    })
}
#[tauri::command]
pub async fn test_optifine_api() -> Result<serde_json::Value, String> {
    let api_url = "https://bmclapi2.bangbang93.com/optifine/versionlist";
    
    println!("[OptiFine] Testing API: {}", api_url);
    
    let client = reqwest::Client::new();
    let response = client
        .get(api_url)
        .header("User-Agent", "ImagineLauncher/1.0.0")
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    println!("[OptiFine] Response status: {}", response.status());
    
    if !response.status().is_success() {
        return Err(format!("API 请求失败: {}", response.status()));
    }
    
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    println!("[OptiFine] Response length: {}", response_text.len());
    
    // 尝试解析前几个条目
    let bmcl_versions: Vec<BMCLOptiFineVersion> = serde_json::from_str(&response_text)
        .map_err(|e| format!("解析失败: {}", e))?;
    
    println!("[OptiFine] Parsed {} versions", bmcl_versions.len());
    
    // 显示前几个版本的信息
    let sample_versions: Vec<_> = bmcl_versions.iter().take(5).collect();
    
    Ok(serde_json::json!({
        "success": true,
        "total_count": bmcl_versions.len(),
        "sample_versions": sample_versions
    }))
}
// 版本比较函数
fn version_compare(a: &str, b: &str) -> std::cmp::Ordering {
    let parse_version = |v: &str| -> Vec<u32> {
        v.split('.')
            .map(|s| s.parse::<u32>().unwrap_or(0))
            .collect()
    };
    
    let va = parse_version(a);
    let vb = parse_version(b);
    
    for i in 0..std::cmp::max(va.len(), vb.len()) {
        let a_part = va.get(i).unwrap_or(&0);
        let b_part = vb.get(i).unwrap_or(&0);
        
        match a_part.cmp(b_part) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    
    std::cmp::Ordering::Equal
}


// ==================== 模组下载功能 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct ModDownloadRequest {
    pub url: String,
    pub filename: String,
    #[serde(rename = "targetVersion")]
    pub target_version: String,
    pub hash: Option<String>,
}

#[tauri::command]
pub async fn download_mod(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    request: ModDownloadRequest,
) -> Result<serde_json::Value, String> {
    let app_state = state.lock().await;
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    drop(app_state);
    
    // 构建 mods 目录路径
    let mods_dir = Path::new(&mc_dir)
        .join("versions")
        .join(&request.target_version)
        .join("mods");
    
    // 如果版本目录下没有 mods 文件夹，尝试使用全局 mods 目录
    let mods_dir = if mods_dir.parent().map(|p| p.exists()).unwrap_or(false) {
        mods_dir
    } else {
        Path::new(&mc_dir).join("mods")
    };
    
    // 确保目录存在
    std::fs::create_dir_all(&mods_dir)
        .map_err(|e| format!("创建 mods 目录失败: {}", e))?;
    
    let file_path = mods_dir.join(&request.filename);
    
    println!("[Mod] Downloading {} to {:?}", request.url, file_path);
    
    // 下载文件
    let client = reqwest::Client::new();
    let response = client
        .get(&request.url)
        .header("User-Agent", "ImagineLauncher/1.0.0")
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    
    let content = response
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    
    // 验证哈希（如果提供）
    if let Some(expected_hash) = &request.hash {
        if expected_hash.len() == 40 {
            // SHA-1
            use sha1::{Sha1, Digest};
            let mut hasher = Sha1::new();
            hasher.update(&content);
            let actual_hash = format!("{:x}", hasher.finalize());
            
            if actual_hash != *expected_hash {
                return Err(format!("文件校验失败: 期望 {} 实际 {}", expected_hash, actual_hash));
            }
        }
        // SHA-512 暂时跳过验证，因为没有 sha2 依赖
    }
    
    // 保存文件
    std::fs::write(&file_path, content)
        .map_err(|e| format!("保存文件失败: {}", e))?;
    
    println!("[Mod] Downloaded successfully: {:?}", file_path);
    
    Ok(serde_json::json!({
        "success": true,
        "path": file_path.to_string_lossy().to_string(),
        "filename": request.filename
    }))
}
