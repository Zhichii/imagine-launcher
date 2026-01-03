use crate::launcher::get_default_mc_dir;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    #[serde(default)]
    pub release_time: Option<String>,
    pub has_jar: bool,
    #[serde(default)]
    pub inherits_from: Option<String>,
    #[serde(default)]
    pub main_class: Option<String>,
    pub loader: String,
}

#[derive(Debug, Clone)]
pub struct RunningInstance {
    pub version_id: String,
    pub start_time: i64,
    pub account_username: String,
    pub exited: bool,
    pub exit_code: Option<i32>,
    pub logs: Vec<LogEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub log_type: String,
    pub message: String,
    pub time: i64,
}

#[tauri::command]
pub async fn scan_versions(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let mc_dir = state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    let versions_dir = Path::new(&mc_dir).join("versions");
    if !versions_dir.exists() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "versions 目录不存在"
        }));
    }
    
    let mut versions = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            
            let version_id = entry.file_name().to_string_lossy().to_string();
            let version_dir = entry.path();
            let json_path = version_dir.join(format!("{}.json", version_id));
            let jar_path = version_dir.join(format!("{}.jar", version_id));
            
            if !json_path.exists() {
                continue;
            }
            
            if let Ok(content) = std::fs::read_to_string(&json_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let loader = detect_loader(&json, &version_id);
                    
                    // 检查 JAR 是否存在（包括继承版本的 JAR）
                    let mut has_jar = jar_path.exists();
                    if !has_jar {
                        // 检查继承版本的 JAR
                        if let Some(inherits) = json["inheritsFrom"].as_str() {
                            let parent_jar = versions_dir.join(inherits).join(format!("{}.jar", inherits));
                            has_jar = parent_jar.exists();
                        }
                    }
                    
                    versions.push(VersionInfo {
                        id: version_id.clone(),
                        version_type: json["type"].as_str().unwrap_or("unknown").to_string(),
                        release_time: json["releaseTime"].as_str().map(|s| s.to_string()),
                        has_jar,
                        inherits_from: json["inheritsFrom"].as_str().map(|s| s.to_string()),
                        main_class: json["mainClass"].as_str().map(|s| s.to_string()),
                        loader,
                    });
                }
            }
        }
    }
    
    // 按发布时间排序
    versions.sort_by(|a, b| {
        b.release_time.as_deref().unwrap_or("")
            .cmp(a.release_time.as_deref().unwrap_or(""))
    });
    
    Ok(serde_json::json!({
        "success": true,
        "versions": versions
    }))
}

fn detect_loader(json: &serde_json::Value, version_id: &str) -> String {
    let id_lower = version_id.to_lowercase();
    let main_class = json["mainClass"].as_str().unwrap_or("");
    
    if id_lower.contains("forge") || main_class.contains("forge") || main_class.contains("fml") {
        return "forge".to_string();
    }
    if id_lower.contains("fabric") || main_class.contains("fabric") {
        return "fabric".to_string();
    }
    if id_lower.contains("quilt") || main_class.contains("quilt") {
        return "quilt".to_string();
    }
    if id_lower.contains("optifine") {
        return "optifine".to_string();
    }
    if id_lower.contains("neoforge") || main_class.contains("neoforge") {
        return "neoforge".to_string();
    }
    "vanilla".to_string()
}


#[tauri::command]
pub async fn get_version_info(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    version_id: String,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let mc_dir = state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    let json_path = Path::new(&mc_dir)
        .join("versions")
        .join(&version_id)
        .join(format!("{}.json", version_id));
    
    if !json_path.exists() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "版本不存在"
        }));
    }
    
    let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "version": json
    }))
}

#[tauri::command]
pub async fn rename_version(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    old_id: String,
    new_id: String,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let mc_dir = state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    let versions_dir = Path::new(&mc_dir).join("versions");
    let old_dir = versions_dir.join(&old_id);
    let new_dir = versions_dir.join(&new_id);
    
    // 检查旧版本是否存在
    if !old_dir.exists() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "原版本不存在"
        }));
    }
    
    // 检查新名称是否已被使用
    if new_dir.exists() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "目标版本名称已存在"
        }));
    }
    
    // 验证新名称
    if new_id.is_empty() || new_id.contains('/') || new_id.contains('\\') || new_id.contains(':') {
        return Ok(serde_json::json!({
            "success": false,
            "error": "无效的版本名称"
        }));
    }
    
    // 重命名文件夹
    if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
        return Ok(serde_json::json!({
            "success": false,
            "error": format!("重命名文件夹失败: {}", e)
        }));
    }
    
    // 重命名 JSON 文件
    let old_json = new_dir.join(format!("{}.json", old_id));
    let new_json = new_dir.join(format!("{}.json", new_id));
    if old_json.exists() {
        // 读取并修改 JSON 内容
        if let Ok(content) = std::fs::read_to_string(&old_json) {
            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                // 更新 id 字段
                if let Some(obj) = json.as_object_mut() {
                    obj.insert("id".to_string(), serde_json::Value::String(new_id.clone()));
                }
                // 写入新文件
                if let Ok(new_content) = serde_json::to_string_pretty(&json) {
                    let _ = std::fs::write(&new_json, new_content);
                }
            }
        }
        // 删除旧 JSON 文件
        let _ = std::fs::remove_file(&old_json);
    }
    
    // 重命名 JAR 文件
    let old_jar = new_dir.join(format!("{}.jar", old_id));
    let new_jar = new_dir.join(format!("{}.jar", new_id));
    if old_jar.exists() {
        let _ = std::fs::rename(&old_jar, &new_jar);
    }
    
    Ok(serde_json::json!({
        "success": true,
        "newId": new_id
    }))
}

#[tauri::command]
pub async fn get_running_instances(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<serde_json::Value>, String> {
    let state = state.lock().await;
    let mut instances = state.running_instances.write().await;
    
    // 检查每个进程是否真正存活
    let mut result = Vec::new();
    for (pid, inst) in instances.iter_mut() {
        if inst.exited {
            continue;
        }
        
        // 检查进程是否存活
        let is_alive = is_process_alive(*pid);
        if !is_alive {
            println!("[Instances] Process {} is no longer alive, marking as exited", pid);
            inst.exited = true;
            continue;
        }
        
        result.push(serde_json::json!({
            "pid": pid,
            "versionId": inst.version_id,
            "startTime": inst.start_time,
            "account": { "username": inst.account_username }
        }));
    }
    
    Ok(result)
}

// 检查进程是否存活
fn is_process_alive(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let output = Command::new("tasklist")
            .args(&["/FI", &format!("PID eq {}", pid), "/NH"])
            .output();
        
        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                // 如果输出包含 PID，说明进程存在
                stdout.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        use std::path::Path;
        // 在 Linux/macOS 上检查 /proc/{pid} 是否存在
        Path::new(&format!("/proc/{}", pid)).exists()
    }
}

#[tauri::command]
pub async fn get_instance_logs(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    pid: u32,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let instances = state.running_instances.read().await;
    
    if let Some(instance) = instances.get(&pid) {
        return Ok(serde_json::json!({
            "success": true,
            "logs": instance.logs
        }));
    }
    
    Ok(serde_json::json!({
        "success": false,
        "error": "实例不存在"
    }))
}

#[tauri::command]
pub async fn kill_instance(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    pid: u32,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let mut instances = state.running_instances.write().await;
    
    if let Some(instance) = instances.get_mut(&pid) {
        if !instance.exited {
            // 终止进程
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(&["/pid", &pid.to_string(), "/f", "/t"])
                    .spawn();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("kill")
                    .args(&["-9", &pid.to_string()])
                    .spawn();
            }
            
            instance.exited = true;
            return Ok(serde_json::json!({ "success": true }));
        }
    }
    
    Ok(serde_json::json!({
        "success": false,
        "error": "实例不存在或已退出"
    }))
}

#[tauri::command]
pub async fn check_duplicate_instance(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    version_id: String,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let instances = state.running_instances.read().await;
    
    for (pid, inst) in instances.iter() {
        if inst.version_id == version_id && !inst.exited {
            return Ok(serde_json::json!({
                "running": true,
                "pid": pid
            }));
        }
    }
    
    Ok(serde_json::json!({ "running": false }))
}

#[tauri::command]
pub async fn get_game_status(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let mut instances = state.running_instances.write().await;
    
    // 检查每个进程是否真正存活
    let mut running_count = 0;
    for (pid, inst) in instances.iter_mut() {
        if inst.exited {
            continue;
        }
        
        if is_process_alive(*pid) {
            running_count += 1;
        } else {
            println!("[GameStatus] Process {} is no longer alive", pid);
            inst.exited = true;
        }
    }
    
    Ok(serde_json::json!({
        "running": running_count > 0,
        "runningCount": running_count
    }))
}

#[tauri::command]
pub async fn kill_game(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let mut instances = state.running_instances.write().await;
    
    for (pid, instance) in instances.iter_mut() {
        if !instance.exited {
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(&["/pid", &pid.to_string(), "/f", "/t"])
                    .spawn();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("kill")
                    .args(&["-9", &pid.to_string()])
                    .spawn();
            }
            instance.exited = true;
        }
    }
    
    Ok(serde_json::json!({ "success": true }))
}


// 游戏启动
#[tauri::command]
pub async fn launch_game(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
    version_id: String,
    account_id: Option<String>,
    force_new_instance: Option<bool>,
) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    
    println!("[Launch] ========== Starting launch_game ==========");
    println!("[Launch] version_id: {}", version_id);
    println!("[Launch] account_id: {:?}", account_id);
    println!("[Launch] force_new_instance: {:?}", force_new_instance);
    
    let send_step = |step: &str, status: &str, message: &str| {
        let _ = app_handle.emit("launch-step", serde_json::json!({
            "step": step,
            "status": status,
            "message": message
        }));
    };
    
    let app_state = state.lock().await;
    
    println!("[Launch] Current launcher_settings.java_path: {:?}", app_state.launcher_settings.java_path);
    println!("[Launch] Current launcher_settings.minecraft_dir: {:?}", app_state.launcher_settings.minecraft_dir);
    
    // 检查重复实例
    if !force_new_instance.unwrap_or(false) {
        let instances = app_state.running_instances.read().await;
        for (pid, inst) in instances.iter() {
            if inst.version_id == version_id && !inst.exited {
                return Ok(serde_json::json!({
                    "success": false,
                    "error": "duplicate_instance",
                    "runningPid": pid,
                    "message": format!("{} 已经在运行中", version_id)
                }));
            }
        }
    }
    
    // 步骤1: 检测账户
    send_step("check-account", "active", "正在验证账户...");
    
    let account = if let Some(aid) = &account_id {
        app_state.accounts_data.accounts.iter().find(|a| &a.id == aid).cloned()
    } else if let Some(current) = &app_state.accounts_data.current_account {
        app_state.accounts_data.accounts.iter().find(|a| &a.id == current).cloned()
    } else {
        None
    };
    
    let account = match account {
        Some(a) => a,
        None => {
            send_step("check-account", "error", "未选择账户");
            return Ok(serde_json::json!({
                "success": false,
                "error": "请先选择一个账户"
            }));
        }
    };
    send_step("check-account", "done", &format!("账户: {}", account.username));
    
    // 步骤2: 检测 Java
    send_step("check-java", "active", "正在检测 Java...");
    
    // 优先使用版本独立设置的 Java 路径
    let version_java_path = app_state.launcher_settings.version_settings
        .get(&version_id)
        .and_then(|vs| vs.java_path.clone());
    
    println!("[Launch] Version-specific Java path: {:?}", version_java_path);
    println!("[Launch] Global Java path: {:?}", app_state.launcher_settings.java_path);
    
    let java_path = version_java_path
        .or_else(|| app_state.launcher_settings.java_path.clone())
        .filter(|p| !p.is_empty());
    
    let java_path = match java_path {
        Some(p) => {
            println!("[Launch] Using Java path: {}", p);
            p
        },
        None => {
            println!("[Launch] Java path is None or empty!");
            send_step("check-java", "error", "未设置 Java 路径");
            return Ok(serde_json::json!({
                "success": false,
                "error": "请先选择 Java"
            }));
        }
    };
    send_step("check-java", "done", &format!("Java: {}", java_path));
    
    // 步骤3: 检查游戏目录
    send_step("check-dir", "active", "正在检查游戏目录...");
    
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    if !Path::new(&mc_dir).exists() {
        send_step("check-dir", "error", "游戏目录不存在");
        return Ok(serde_json::json!({
            "success": false,
            "error": "请先设置 .minecraft 目录"
        }));
    }
    send_step("check-dir", "done", "游戏目录已就绪");
    
    // 步骤4-6: 构建启动参数
    send_step("build-classpath", "active", "正在处理游戏依赖...");
    
    let launch_result = build_and_launch(
        &mc_dir,
        &version_id,
        &java_path,
        &account,
        &app_state.launcher_settings,
        app_handle.clone(),
    ).await;
    
    match launch_result {
        Ok(pid) => {
            send_step("launch", "done", "游戏已启动");
            
            // 注册运行实例
            let mut instances = app_state.running_instances.write().await;
            instances.insert(pid, RunningInstance {
                version_id: version_id.clone(),
                start_time: chrono::Utc::now().timestamp_millis(),
                account_username: account.username.clone(),
                exited: false,
                exit_code: None,
                logs: Vec::new(),
            });
            
            let _ = app_handle.emit("instance-started", serde_json::json!({
                "pid": pid,
                "versionId": version_id,
                "account": { "username": account.username }
            }));
            
            // 检查版本独立设置的启动器行为，如果没有则使用全局设置
            let launcher_behavior = app_state.launcher_settings.version_settings
                .get(&version_id)
                .and_then(|vs| vs.launcher_behavior.clone())
                .unwrap_or_else(|| app_state.launcher_settings.launcher_behavior.clone());
            
            println!("[Launch] Using launcher behavior: {} (version setting: {:?})", 
                launcher_behavior,
                app_state.launcher_settings.version_settings.get(&version_id).and_then(|vs| vs.launcher_behavior.clone()));
            
            Ok(serde_json::json!({
                "success": true,
                "pid": pid,
                "launcherBehavior": launcher_behavior
            }))
        }
        Err(e) => {
            send_step("launch", "error", &e);
            Ok(serde_json::json!({
                "success": false,
                "error": e
            }))
        }
    }
}


async fn build_and_launch(
    mc_dir: &str,
    version_id: &str,
    java_path: &str,
    account: &crate::accounts::Account,
    settings: &crate::launcher::LauncherSettings,
    app_handle: tauri::AppHandle,
) -> Result<u32, String> {
    use tauri::Emitter;
    
    let mc_path = Path::new(mc_dir);
    let versions_dir = mc_path.join("versions");
    let version_dir = versions_dir.join(version_id);
    let json_path = version_dir.join(format!("{}.json", version_id));
    
    // 读取版本 JSON
    let content = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("无法读取版本文件: {}", e))?;
    let version_json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("无法解析版本文件: {}", e))?;
    
    // 解析继承链并合并
    let merged = merge_version_chain(mc_dir, &version_json)?;
    
    let _ = app_handle.emit("launch-step", serde_json::json!({
        "step": "build-classpath",
        "status": "done",
        "message": "依赖处理完成"
    }));
    
    // 提取 natives
    let _ = app_handle.emit("launch-step", serde_json::json!({
        "step": "extract-natives",
        "status": "active",
        "message": "正在提取本地库..."
    }));
    
    let natives_dir = version_dir.join("natives");
    std::fs::create_dir_all(&natives_dir).ok();
    extract_natives(mc_dir, &merged, &natives_dir)?;
    
    let _ = app_handle.emit("launch-step", serde_json::json!({
        "step": "extract-natives",
        "status": "done",
        "message": "本地库已就绪"
    }));
    
    // 构建 classpath
    let _ = app_handle.emit("launch-step", serde_json::json!({
        "step": "build-args",
        "status": "active",
        "message": "正在构建启动参数..."
    }));
    
    let classpath = build_classpath(mc_dir, version_id, &merged)?;
    
    // 构建参数 - 优先使用版本独立设置
    let version_settings = settings.version_settings.get(version_id);
    
    // 内存设置
    let memory_min = version_settings
        .and_then(|vs| vs.memory_min)
        .unwrap_or(settings.memory.min);
    let memory_max = version_settings
        .and_then(|vs| vs.memory_max)
        .unwrap_or(settings.memory.max);
    
    // 窗口大小
    let window_width = version_settings
        .and_then(|vs| vs.window_width)
        .unwrap_or(settings.window_size.width);
    let window_height = version_settings
        .and_then(|vs| vs.window_height)
        .unwrap_or(settings.window_size.height);
    
    let effective_window_size = crate::launcher::WindowSize {
        width: window_width,
        height: window_height,
    };
    
    println!("[Launch] Memory: {}MB - {}MB (version override: {:?})", 
        memory_min, memory_max, 
        version_settings.and_then(|vs| vs.memory_max));
    println!("[Launch] Window: {}x{} (version override: {:?})", 
        window_width, window_height,
        version_settings.and_then(|vs| vs.window_width));
    
    // 构建 JVM 参数变量映射
    let version_jar = version_dir.join(format!("{}.jar", version_id));
    let actual_jar = if version_jar.exists() {
        version_jar.clone()
    } else if let Some(inherits) = merged["inheritsFrom"].as_str() {
        versions_dir.join(inherits).join(format!("{}.jar", inherits))
    } else {
        version_jar.clone()
    };
    
    let jvm_variables: HashMap<&str, String> = [
        ("natives_directory", natives_dir.to_string_lossy().to_string()),
        ("launcher_name", "ImagineLauncher".to_string()),
        ("launcher_version", "1.0.0".to_string()),
        ("classpath", classpath.clone()),
        ("classpath_separator", if cfg!(windows) { ";" } else { ":" }.to_string()),
        ("library_directory", mc_path.join("libraries").to_string_lossy().to_string()),
        ("version_name", version_id.to_string()),
        ("primary_jar", actual_jar.to_string_lossy().to_string()),
        ("primary_jar_name", actual_jar.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()),
    ].into_iter().collect();
    
    // 检测是否是旧版本（1.12.2 及以下）- 使用 minecraftArguments 而不是 arguments
    let is_old_version = merged.get("minecraftArguments").is_some() 
        && merged.pointer("/arguments/jvm").is_none();
    
    println!("[Launch] Is old version (uses minecraftArguments): {}", is_old_version);
    
    let mut jvm_args = Vec::new();
    
    // 内存参数
    jvm_args.push(format!("-Xms{}M", memory_min));
    jvm_args.push(format!("-Xmx{}M", memory_max));
    
    // GC 优化参数
    jvm_args.push("-XX:+UnlockExperimentalVMOptions".to_string());
    jvm_args.push("-XX:+UseG1GC".to_string());
    jvm_args.push("-XX:G1NewSizePercent=20".to_string());
    jvm_args.push("-XX:G1ReservePercent=20".to_string());
    jvm_args.push("-XX:MaxGCPauseMillis=50".to_string());
    jvm_args.push("-XX:G1HeapRegionSize=32m".to_string());
    jvm_args.push("-XX:-UseAdaptiveSizePolicy".to_string());
    jvm_args.push("-XX:-OmitStackTraceInFastThrow".to_string());
    
    // Log4j 安全修复
    jvm_args.push("-Dlog4j2.formatMsgNoLookups=true".to_string());
    
    // 32位 JVM 需要更大的栈空间
    jvm_args.push("-Xss1M".to_string());
    
    // Windows 特定参数 - Intel 显卡兼容性
    #[cfg(target_os = "windows")]
    {
        jvm_args.push("-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump".to_string());
        // Windows 10 兼容性参数 - 只用于新版本 (1.13+)
        if !is_old_version {
            jvm_args.push("-Dos.name=Windows 10".to_string());
            jvm_args.push("-Dos.version=10.0".to_string());
        }
    }
    
    // Forge 兼容性参数
    jvm_args.push("-Dfml.ignoreInvalidMinecraftCertificates=true".to_string());
    jvm_args.push("-Dfml.ignorePatchDiscrepancies=true".to_string());
    
    // 辅助函数：检查是否是有效的 JVM 参数
    let is_valid_jvm_arg = |s: &str| -> bool {
        // 跳过 -cp 和 -classpath（我们自己处理）
        if s.starts_with("-cp") || s.starts_with("-classpath") || s == "${classpath}" {
            return false;
        }
        // 跳过纯变量（如 ${primary_jar}）- 这些不是有效的 JVM 参数
        if s.starts_with("${") && s.ends_with("}") && !s.contains("-D") && !s.contains("-X") {
            return false;
        }
        // 必须以 - 开头才是有效的 JVM 参数
        s.starts_with("-")
    };
    
    // 处理版本 JSON 中的 JVM 参数 (1.13+)
    if let Some(jvm_args_json) = merged.pointer("/arguments/jvm").and_then(|v| v.as_array()) {
        for arg in jvm_args_json {
            if let Some(s) = arg.as_str() {
                let processed = replace_variables(s, &jvm_variables);
                if is_valid_jvm_arg(&processed) {
                    jvm_args.push(processed);
                }
            } else if let Some(obj) = arg.as_object() {
                if !check_rules(obj.get("rules")) {
                    continue;
                }
                if let Some(value) = obj.get("value") {
                    if let Some(s) = value.as_str() {
                        let processed = replace_variables(s, &jvm_variables);
                        if is_valid_jvm_arg(&processed) {
                            jvm_args.push(processed);
                        }
                    } else if let Some(arr) = value.as_array() {
                        for v in arr {
                            if let Some(s) = v.as_str() {
                                let processed = replace_variables(s, &jvm_variables);
                                if is_valid_jvm_arg(&processed) {
                                    jvm_args.push(processed);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 确保必要的参数存在（参考 RiverLauncher 的逻辑）
    if !jvm_args.iter().any(|a| a.contains("-Djava.library.path")) {
        jvm_args.push(format!("-Djava.library.path={}", natives_dir.display()));
    }
    if !jvm_args.iter().any(|a| a.contains("-Dminecraft.launcher.brand")) {
        jvm_args.push("-Dminecraft.launcher.brand=ImagineLauncher".to_string());
    }
    if !jvm_args.iter().any(|a| a.contains("-Dminecraft.launcher.version")) {
        jvm_args.push("-Dminecraft.launcher.version=1.0.0".to_string());
    }
    
    // 为旧版本添加额外的必要参数
    if is_old_version {
        // LWJGL 和 JNA 临时目录设置
        if !jvm_args.iter().any(|a| a.contains("-Djna.tmpdir")) {
            jvm_args.push(format!("-Djna.tmpdir={}", natives_dir.display()));
        }
        if !jvm_args.iter().any(|a| a.contains("-Dorg.lwjgl.system.SharedLibraryExtractPath")) {
            jvm_args.push(format!("-Dorg.lwjgl.system.SharedLibraryExtractPath={}", natives_dir.display()));
        }
        if !jvm_args.iter().any(|a| a.contains("-Dio.netty.native.workdir")) {
            jvm_args.push(format!("-Dio.netty.native.workdir={}", natives_dir.display()));
        }
    }
    
    // 添加 classpath（放在最后）
    jvm_args.push("-cp".to_string());
    jvm_args.push(classpath);
    
    let main_class = merged["mainClass"].as_str()
        .ok_or("无法确定主类")?
        .to_string();
    
    let game_args = build_game_args(mc_dir, version_id, &merged, account, &effective_window_size)?;
    
    // 打印完整的启动命令用于调试
    println!("[Launch] JVM args: {:?}", jvm_args);
    println!("[Launch] Main class: {}", main_class);
    println!("[Launch] Game args: {:?}", game_args);
    
    let _ = app_handle.emit("launch-step", serde_json::json!({
        "step": "build-args",
        "status": "done",
        "message": format!("内存: {}MB", memory_max)
    }));
    
    // 启动游戏
    let _ = app_handle.emit("launch-step", serde_json::json!({
        "step": "launch",
        "status": "active",
        "message": "正在启动游戏..."
    }));
    
    let mut cmd = std::process::Command::new(java_path);
    cmd.args(&jvm_args)
        .arg(&main_class)
        .args(&game_args)
        .current_dir(mc_dir);
    
    // 不要 pipe stdout/stderr，让游戏进程独立运行
    // 这样可以避免 GUI 窗口无法显示的问题
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // 使用 DETACHED_PROCESS (0x00000008) 让游戏在独立进程中运行
        // 同时使用 CREATE_NEW_PROCESS_GROUP (0x00000200) 创建新的进程组
        cmd.creation_flags(0x00000008 | 0x00000200);
    }
    
    // 打印完整的启动命令用于调试
    println!("[Launch] Full command: {} {} {} {}", 
        java_path,
        jvm_args.join(" "),
        main_class,
        game_args.join(" ")
    );
    
    let child = cmd.spawn().map_err(|e| format!("启动失败: {}", e))?;
    let pid = child.id();
    
    println!("[Launch] Game process started with PID: {}", pid);
    
    // 启动后台任务监控进程状态（不监控输出，只监控退出）
    let version_id_clone = version_id.to_string();
    let app_handle_clone = app_handle.clone();
    
    tokio::spawn(async move {
        monitor_game_process_simple(child, version_id_clone, app_handle_clone).await;
    });
    
    Ok(pid)
}

fn merge_version_chain(mc_dir: &str, version_json: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut merged = version_json.clone();
    
    if let Some(inherits_from) = version_json["inheritsFrom"].as_str() {
        let parent_path = Path::new(mc_dir)
            .join("versions")
            .join(inherits_from)
            .join(format!("{}.json", inherits_from));
        
        if parent_path.exists() {
            let parent_content = std::fs::read_to_string(&parent_path)
                .map_err(|e| e.to_string())?;
            let parent_json: serde_json::Value = serde_json::from_str(&parent_content)
                .map_err(|e| e.to_string())?;
            
            let parent_merged = merge_version_chain(mc_dir, &parent_json)?;
            
            // 合并字段
            if merged.get("mainClass").is_none() {
                merged["mainClass"] = parent_merged["mainClass"].clone();
            }
            if merged.get("assets").is_none() {
                merged["assets"] = parent_merged["assets"].clone();
            }
            if merged.get("assetIndex").is_none() {
                merged["assetIndex"] = parent_merged["assetIndex"].clone();
            }
            
            // 合并 libraries
            if let Some(parent_libs) = parent_merged["libraries"].as_array() {
                let mut libs = parent_libs.clone();
                if let Some(child_libs) = merged["libraries"].as_array() {
                    libs.extend(child_libs.clone());
                }
                merged["libraries"] = serde_json::Value::Array(libs);
            }
            
            // 合并 arguments
            if let Some(parent_args) = parent_merged.get("arguments") {
                if merged.get("arguments").is_none() {
                    merged["arguments"] = parent_args.clone();
                }
            }
            if merged.get("minecraftArguments").is_none() {
                if let Some(mc_args) = parent_merged.get("minecraftArguments") {
                    merged["minecraftArguments"] = mc_args.clone();
                }
            }
        }
    }
    
    Ok(merged)
}


fn build_classpath(mc_dir: &str, version_id: &str, merged: &serde_json::Value) -> Result<String, String> {
    let mut classpath = Vec::new();
    let libraries_dir = Path::new(mc_dir).join("libraries");
    
    println!("[Classpath] Libraries dir: {:?}", libraries_dir);
    
    if let Some(libs) = merged["libraries"].as_array() {
        println!("[Classpath] Found {} libraries in version JSON", libs.len());
        for lib in libs {
            // 检查规则
            if !check_rules(lib.get("rules")) {
                continue;
            }
            
            // 跳过 natives（但不跳过有 natives 字段但也有 artifact 的库）
            let has_natives = lib.get("natives").is_some();
            let has_artifact = lib.pointer("/downloads/artifact").is_some() || lib.get("name").is_some();
            
            if has_natives && !has_artifact {
                continue;
            }
            
            // 获取库路径
            if let Some(path) = get_library_path(lib, &libraries_dir) {
                if path.exists() {
                    if !classpath.contains(&path) {
                        classpath.push(path);
                    }
                } else {
                    println!("[Classpath] Library not found: {:?}", path);
                }
            }
        }
    } else {
        println!("[Classpath] No libraries array found in version JSON!");
    }
    
    println!("[Classpath] Found {} libraries", classpath.len());
    
    // 添加版本 JAR
    let version_jar = Path::new(mc_dir)
        .join("versions")
        .join(version_id)
        .join(format!("{}.jar", version_id));
    
    if version_jar.exists() {
        classpath.push(version_jar);
    } else if let Some(inherits) = merged["inheritsFrom"].as_str() {
        let parent_jar = Path::new(mc_dir)
            .join("versions")
            .join(inherits)
            .join(format!("{}.jar", inherits));
        if parent_jar.exists() {
            classpath.push(parent_jar);
        }
    }
    
    #[cfg(target_os = "windows")]
    let separator = ";";
    #[cfg(not(target_os = "windows"))]
    let separator = ":";
    
    Ok(classpath.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(separator))
}

fn get_library_path(lib: &serde_json::Value, libraries_dir: &Path) -> Option<PathBuf> {
    // 优先使用 downloads.artifact.path
    if let Some(path) = lib.pointer("/downloads/artifact/path").and_then(|v| v.as_str()) {
        return Some(libraries_dir.join(path));
    }
    
    // 从 name 解析路径
    if let Some(name) = lib["name"].as_str() {
        let parts: Vec<&str> = name.split(':').collect();
        if parts.len() >= 3 {
            let group = parts[0].replace('.', "/");
            let artifact = parts[1];
            let version = parts[2];
            
            // 检查是否有 classifier（可能在第4个部分，或者在版本号后面用 @ 分隔）
            let (version, classifier) = if let Some(at_pos) = version.find('@') {
                (&version[..at_pos], None) // 忽略 @ 后面的部分（通常是扩展名）
            } else {
                (version, parts.get(3).map(|s| *s))
            };
            
            let filename = if let Some(c) = classifier {
                format!("{}-{}-{}.jar", artifact, version, c)
            } else {
                format!("{}-{}.jar", artifact, version)
            };
            
            return Some(libraries_dir.join(&group).join(artifact).join(version).join(filename));
        }
    }
    
    None
}

fn extract_natives(mc_dir: &str, merged: &serde_json::Value, natives_dir: &Path) -> Result<(), String> {
    let libraries_dir = Path::new(mc_dir).join("libraries");
    
    println!("[Natives] Extracting natives to: {:?}", natives_dir);
    
    if let Some(libs) = merged["libraries"].as_array() {
        for lib in libs {
            if !check_rules(lib.get("rules")) {
                continue;
            }
            
            if let Some(natives) = lib.get("natives") {
                let current_os = get_current_os();
                let native_key = natives[&current_os].as_str();
                if let Some(key) = native_key {
                    // 替换 ${arch} 变量
                    let key = key.replace("${arch}", if cfg!(target_pointer_width = "64") { "64" } else { "32" });
                    
                    // 方式1: 新版格式 - 使用 downloads/classifiers
                    if let Some(path) = lib.pointer(&format!("/downloads/classifiers/{}/path", key))
                        .and_then(|v| v.as_str()) 
                    {
                        let native_path = libraries_dir.join(path);
                        println!("[Natives] Found native (new format): {:?}", native_path);
                        if native_path.exists() {
                            extract_jar_natives(&native_path, natives_dir)?;
                        } else {
                            println!("[Natives] Native file not found: {:?}", native_path);
                        }
                    }
                    // 方式2: 旧版格式 - 从 name 构建路径
                    else if let Some(name) = lib["name"].as_str() {
                        let parts: Vec<&str> = name.split(':').collect();
                        if parts.len() >= 3 {
                            let group = parts[0].replace('.', "/");
                            let artifact = parts[1];
                            let version = parts[2];
                            
                            // 构建带 classifier 的文件名
                            let filename = format!("{}-{}-{}.jar", artifact, version, key);
                            let native_path = libraries_dir.join(&group).join(artifact).join(version).join(&filename);
                            
                            println!("[Natives] Found native (old format): {:?}", native_path);
                            if native_path.exists() {
                                extract_jar_natives(&native_path, natives_dir)?;
                            } else {
                                println!("[Natives] Native file not found: {:?}", native_path);
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(())
}

fn extract_jar_natives(jar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(jar_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        
        if name.starts_with("META-INF/") || file.is_dir() {
            continue;
        }
        
        let is_native = name.ends_with(".dll") 
            || name.ends_with(".so") 
            || name.ends_with(".dylib")
            || name.ends_with(".jnilib");
        
        if is_native {
            let dest_path = dest_dir.join(Path::new(&name).file_name().unwrap_or_default());
            if !dest_path.exists() {
                let mut dest_file = std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut dest_file).map_err(|e| e.to_string())?;
            }
        }
    }
    
    Ok(())
}

fn get_current_os() -> String {
    #[cfg(target_os = "windows")]
    return "windows".to_string();
    #[cfg(target_os = "macos")]
    return "osx".to_string();
    #[cfg(target_os = "linux")]
    return "linux".to_string();
}

fn check_rules(rules: Option<&serde_json::Value>) -> bool {
    let rules = match rules {
        Some(r) => r.as_array(),
        None => return true,
    };
    
    let rules = match rules {
        Some(r) => r,
        None => return true,
    };
    
    if rules.is_empty() {
        return true;
    }
    
    let current_os = get_current_os();
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
        
        if rule.get("features").is_some() {
            matches = false;
        }
        
        if matches {
            result = action;
        }
    }
    
    result
}


fn build_game_args(
    mc_dir: &str,
    version_id: &str,
    merged: &serde_json::Value,
    account: &crate::accounts::Account,
    window_size: &crate::launcher::WindowSize,
) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    
    let uuid = account.uuid.replace("-", "");
    let access_token = account.access_token.as_deref().unwrap_or(&uuid);
    let user_type = if account.account_type == "microsoft" { "msa" } else { "legacy" };
    
    let assets_index = merged["assets"].as_str()
        .or_else(|| merged.pointer("/assetIndex/id").and_then(|v| v.as_str()))
        .unwrap_or(version_id);
    
    // 获取游戏目录（可能是版本隔离目录）
    let game_dir = mc_dir.to_string();
    let assets_dir = Path::new(mc_dir).join("assets").to_string_lossy().to_string();
    
    let variables: HashMap<&str, String> = [
        ("auth_player_name", account.username.clone()),
        ("version_name", version_id.to_string()),
        ("game_directory", game_dir.clone()),
        ("assets_root", assets_dir.clone()),
        ("game_assets", assets_dir.clone()), // 旧版本使用 game_assets
        ("assets_index_name", assets_index.to_string()),
        ("auth_uuid", uuid.clone()),
        ("auth_access_token", access_token.to_string()),
        ("auth_session", access_token.to_string()), // 旧版本使用 auth_session
        ("user_type", user_type.to_string()),
        ("version_type", merged["type"].as_str().unwrap_or("release").to_string()),
        ("user_properties", "{}".to_string()),
        ("resolution_width", window_size.width.to_string()),
        ("resolution_height", window_size.height.to_string()),
    ].into_iter().collect();
    
    // 新版参数格式 (1.13+)
    if let Some(game_args) = merged.pointer("/arguments/game").and_then(|v| v.as_array()) {
        for arg in game_args {
            if let Some(s) = arg.as_str() {
                args.push(replace_variables(s, &variables));
            } else if let Some(obj) = arg.as_object() {
                if !check_rules(obj.get("rules")) {
                    continue;
                }
                if let Some(value) = obj.get("value") {
                    if let Some(s) = value.as_str() {
                        args.push(replace_variables(s, &variables));
                    } else if let Some(arr) = value.as_array() {
                        for v in arr {
                            if let Some(s) = v.as_str() {
                                args.push(replace_variables(s, &variables));
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 旧版参数格式 (1.12.2 及以下)
    if let Some(mc_args) = merged["minecraftArguments"].as_str() {
        for arg in mc_args.split_whitespace() {
            args.push(replace_variables(arg, &variables));
        }
    }
    
    // 窗口大小
    if !args.iter().any(|a| a == "--width") {
        args.push("--width".to_string());
        args.push(window_size.width.to_string());
        args.push("--height".to_string());
        args.push(window_size.height.to_string());
    }
    
    Ok(args)
}

fn replace_variables(s: &str, variables: &HashMap<&str, String>) -> String {
    let mut result = s.to_string();
    for (key, value) in variables {
        result = result.replace(&format!("${{{}}}", key), value);
    }
    result
}

// 监控单个游戏进程
async fn monitor_game_process(
    mut child: std::process::Child,
    version_id: String,
    app_handle: tauri::AppHandle,
) {
    use std::io::{BufRead, BufReader};
    use tauri::Emitter;
    
    let pid = child.id();
    println!("[GameMonitor] Starting monitor for {} (PID: {})", version_id, pid);
    
    // 收集 stderr 输出（错误日志）
    let stderr = child.stderr.take();
    let stdout = child.stdout.take();
    
    let mut error_logs: Vec<String> = Vec::new();
    let mut all_logs: Vec<String> = Vec::new();
    
    // 读取 stderr
    if let Some(stderr) = stderr {
        let reader = BufReader::new(stderr);
        for line in reader.lines().take(1000) {
            if let Ok(line) = line {
                error_logs.push(line.clone());
                all_logs.push(format!("[STDERR] {}", line));
            }
        }
    }
    
    // 读取 stdout
    if let Some(stdout) = stdout {
        let reader = BufReader::new(stdout);
        for line in reader.lines().take(500) {
            if let Ok(line) = line {
                all_logs.push(format!("[STDOUT] {}", line));
            }
        }
    }
    
    // 等待进程退出
    let exit_status = child.wait();
    
    match exit_status {
        Ok(status) => {
            let exit_code = status.code().unwrap_or(-1);
            println!("[GameMonitor] {} exited with code: {}", version_id, exit_code);
            
            // 分析崩溃原因
            let crash_info = if exit_code != 0 {
                Some(analyze_crash(&error_logs, &all_logs, exit_code))
            } else {
                None
            };
            
            // 发送退出事件
            let _ = app_handle.emit("game-exited", serde_json::json!({
                "pid": pid,
                "versionId": version_id,
                "exitCode": exit_code,
                "crashed": exit_code != 0,
                "crashInfo": crash_info
            }));
            
            // 如果崩溃，打开崩溃报告窗口
            if exit_code != 0 {
                let crash_data = serde_json::json!({
                    "versionId": version_id,
                    "exitCode": exit_code,
                    "crashInfo": crash_info,
                    "errorLogs": error_logs.iter().rev().take(200).collect::<Vec<_>>()
                });
                
                open_crash_report_window(app_handle, crash_data).await;
            }
        }
        Err(e) => {
            println!("[GameMonitor] Failed to wait for {}: {}", version_id, e);
            let _ = app_handle.emit("game-exited", serde_json::json!({
                "pid": pid,
                "versionId": version_id,
                "exitCode": -1,
                "crashed": true
            }));
        }
    }
}

// 简化版进程监控 - 不读取输出，只监控退出状态
async fn monitor_game_process_simple(
    mut child: std::process::Child,
    version_id: String,
    app_handle: tauri::AppHandle,
) {
    use tauri::Emitter;
    
    let pid = child.id();
    println!("[GameMonitor] Starting simple monitor for {} (PID: {})", version_id, pid);
    
    // 等待进程退出
    let exit_status = child.wait();
    
    match exit_status {
        Ok(status) => {
            let exit_code = status.code().unwrap_or(-1);
            println!("[GameMonitor] {} exited with code: {}", version_id, exit_code);
            
            // 发送退出事件
            let _ = app_handle.emit("game-exited", serde_json::json!({
                "pid": pid,
                "versionId": version_id,
                "exitCode": exit_code,
                "crashed": exit_code != 0
            }));
            
            // 如果崩溃，尝试读取游戏日志文件来分析
            if exit_code != 0 {
                // 尝试从游戏日志目录读取错误信息
                let crash_info = analyze_crash_from_logs(&app_handle, &version_id, exit_code).await;
                
                let crash_data = serde_json::json!({
                    "versionId": version_id,
                    "exitCode": exit_code,
                    "crashInfo": crash_info,
                    "errorLogs": []
                });
                
                open_crash_report_window(app_handle, crash_data).await;
            }
        }
        Err(e) => {
            println!("[GameMonitor] Failed to wait for {}: {}", version_id, e);
            let _ = app_handle.emit("game-exited", serde_json::json!({
                "pid": pid,
                "versionId": version_id,
                "exitCode": -1,
                "crashed": true
            }));
        }
    }
}

// 从游戏日志文件分析崩溃原因
async fn analyze_crash_from_logs(
    app_handle: &tauri::AppHandle,
    version_id: &str,
    exit_code: i32,
) -> serde_json::Value {
    use tauri::Manager;
    
    // 获取 minecraft 目录
    let mc_dir = if let Some(state) = app_handle.try_state::<std::sync::Arc<tokio::sync::Mutex<crate::state::AppState>>>() {
        let state = state.lock().await;
        state.launcher_settings.minecraft_dir.clone()
            .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string())
    } else {
        get_default_mc_dir().to_string_lossy().to_string()
    };
    
    let logs_dir = Path::new(&mc_dir).join("logs");
    let latest_log = logs_dir.join("latest.log");
    
    let mut error_logs = Vec::new();
    
    // 读取 latest.log 的最后 200 行
    if latest_log.exists() {
        if let Ok(content) = std::fs::read_to_string(&latest_log) {
            let lines: Vec<&str> = content.lines().collect();
            let start = if lines.len() > 200 { lines.len() - 200 } else { 0 };
            for line in &lines[start..] {
                error_logs.push(line.to_string());
            }
        }
    }
    
    // 检查 crash-reports 目录
    let crash_reports_dir = Path::new(&mc_dir).join("crash-reports");
    if crash_reports_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&crash_reports_dir) {
            let mut crash_files: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|ext| ext == "txt").unwrap_or(false))
                .collect();
            
            crash_files.sort_by(|a, b| {
                let time_a = a.metadata().and_then(|m| m.modified()).ok();
                let time_b = b.metadata().and_then(|m| m.modified()).ok();
                time_b.cmp(&time_a)
            });
            
            // 读取最新的崩溃报告
            if let Some(latest_crash) = crash_files.first() {
                if let Ok(content) = std::fs::read_to_string(latest_crash.path()) {
                    // 检查是否是最近的崩溃报告（5分钟内）
                    if let Ok(metadata) = latest_crash.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            let now = std::time::SystemTime::now();
                            if let Ok(duration) = now.duration_since(modified) {
                                if duration.as_secs() < 300 {
                                    // 添加崩溃报告内容
                                    for line in content.lines().take(100) {
                                        error_logs.push(line.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    analyze_crash(&error_logs, &error_logs, exit_code)
}

// 打开崩溃报告窗口
async fn open_crash_report_window(app_handle: tauri::AppHandle, crash_data: serde_json::Value) {
    use tauri::Manager;
    
    // 存储崩溃数据供窗口获取
    if let Some(state) = app_handle.try_state::<std::sync::Arc<tokio::sync::Mutex<crate::state::AppState>>>() {
        let mut state = state.lock().await;
        state.last_crash_data = Some(crash_data.clone());
    }
    
    // 创建崩溃报告窗口
    let crash_window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "crash-report",
        tauri::WebviewUrl::App("crash-report.html".into())
    )
    .title("游戏崩溃报告")
    .inner_size(1021.0, 620.0)
    .min_inner_size(600.0, 400.0)
    .center()
    .decorations(false)
    .transparent(true)
    .focused(true)
    .build();
    
    match crash_window {
        Ok(window) => {
            println!("[CrashReport] Window created successfully");
            let _ = window.show();
        }
        Err(e) => {
            println!("[CrashReport] Failed to create window: {}", e);
        }
    }
}

// 分析崩溃原因 - 增强版
fn analyze_crash(error_logs: &[String], all_logs: &[String], exit_code: i32) -> serde_json::Value {
    let error_text = error_logs.join("\n");
    let all_text = all_logs.join("\n");
    let error_lower = error_text.to_lowercase();
    let all_lower = all_text.to_lowercase();
    
    let mut reason = "游戏异常退出".to_string();
    let mut details = format!("退出码: {}", exit_code);
    let mut suggestions: Vec<&str> = vec![];
    
    // 1. Java 版本不兼容 - 最常见的问题
    if error_lower.contains("unsupportedclassversionerror") 
        || error_lower.contains("class file version")
        || error_lower.contains("has been compiled by a more recent version")
        || error_text.contains("UnsupportedClassVersionError")
        || error_text.contains("class file version 61") // Java 17
        || error_text.contains("class file version 65") // Java 21
        || error_text.contains("class file version 52") // Java 8
        || all_lower.contains("unsupportedclassversionerror")
        // ClassCastException: URLClassLoader - Java 9+ 不再使用 URLClassLoader
        || (error_text.contains("ClassCastException") && error_text.contains("URLClassLoader"))
        || (error_lower.contains("classcastexception") && error_lower.contains("urlclassloader"))
        || error_text.contains("cannot be cast to class java.net.URLClassLoader")
        || error_text.contains("AppClassLoader cannot be cast")
        // Java 模块系统相关错误
        || error_text.contains("module java.base")
        || (error_lower.contains("illegalaccesserror") && error_lower.contains("module")) {
        reason = "Java 版本不兼容".to_string();
        
        // 尝试提取具体版本信息
        if error_text.contains("class file version 65") || error_text.contains("Java 21") {
            details = "游戏需要 Java 21，但当前使用的 Java 版本过低".to_string();
        } else if error_text.contains("class file version 61") || error_text.contains("Java 17") {
            details = "游戏需要 Java 17，但当前使用的 Java 版本过低".to_string();
        } else if error_text.contains("class file version 52") {
            details = "游戏需要 Java 8，但当前使用的 Java 版本可能不兼容".to_string();
        } else if error_text.contains("URLClassLoader") || error_text.contains("AppClassLoader") {
            details = "游戏/模组使用了旧版 Java API (URLClassLoader)，需要 Java 8 运行".to_string();
        } else if error_text.contains("module java.base") {
            details = "Java 模块系统冲突，通常是 Java 版本过高导致".to_string();
        } else {
            details = "游戏需要的 Java 版本与当前使用的不匹配".to_string();
        }
        
        suggestions = vec![
            "Minecraft 1.8-1.16 需要 Java 8",
            "Minecraft 1.17 需要 Java 16+",
            "Minecraft 1.18-1.20.4 需要 Java 17+",
            "Minecraft 1.20.5+ 需要 Java 21+",
            "如果使用旧版 Forge/模组，可能需要 Java 8",
            "请在版本设置中选择正确的 Java 版本",
        ];
    }
    // 2. Java 找不到或无法执行
    else if error_lower.contains("cannot find java") 
        || error_lower.contains("java not found")
        || error_lower.contains("'java' is not recognized")
        || error_lower.contains("error: could not find or load main class")
        || error_text.contains("Error: Could not find or load main class") {
        reason = "Java 无法启动".to_string();
        details = "找不到 Java 或 Java 无法正常执行".to_string();
        suggestions = vec![
            "检查 Java 路径是否正确",
            "确保 Java 已正确安装",
            "尝试重新选择 Java 路径",
        ];
    }
    // 3. 内存不足
    else if error_lower.contains("outofmemoryerror") 
        || error_lower.contains("out of memory")
        || error_lower.contains("gc overhead limit exceeded")
        || error_lower.contains("java heap space")
        || error_text.contains("OutOfMemoryError") {
        reason = "内存不足".to_string();
        details = "游戏运行时内存耗尽 (OutOfMemoryError)".to_string();
        suggestions = vec![
            "增加分配给游戏的内存（建议 4GB 以上）",
            "关闭其他占用内存的程序",
            "减少游戏中的视距和渲染设置",
            "如果使用了大量模组，考虑减少模组数量",
        ];
    }
    // 4. OpenGL / 显卡错误
    else if (error_lower.contains("opengl") || error_lower.contains("gl error"))
        && (error_lower.contains("error") || error_lower.contains("failed") || error_lower.contains("not supported")) {
        reason = "显卡/OpenGL 错误".to_string();
        details = "图形渲染出现问题，可能是显卡驱动或 OpenGL 版本问题".to_string();
        suggestions = vec![
            "更新显卡驱动程序到最新版本",
            "检查显卡是否支持 OpenGL 4.4+",
            "尝试在游戏设置中降低图形质量",
            "如果使用 OptiFine/光影，尝试禁用",
        ];
    }
    // 5. LWJGL 错误
    else if error_lower.contains("lwjgl") && (error_lower.contains("error") || error_lower.contains("failed") || error_lower.contains("exception")) {
        reason = "LWJGL 库错误".to_string();
        details = "游戏图形库 (LWJGL) 加载失败".to_string();
        suggestions = vec![
            "尝试重新下载游戏版本",
            "检查 natives 文件是否完整",
            "更新显卡驱动程序",
            "检查是否有杀毒软件阻止了 DLL 文件",
        ];
    }
    // 6. 模组问题 - Mixin 错误
    else if error_lower.contains("mixin") && (error_lower.contains("error") || error_lower.contains("failed") || error_lower.contains("exception")) {
        reason = "模组注入错误 (Mixin)".to_string();
        details = "模组代码注入时发生错误，通常是模组不兼容导致".to_string();
        suggestions = vec![
            "检查模组是否与游戏版本兼容",
            "尝试移除最近添加的模组",
            "检查是否有多个模组修改了相同的游戏代码",
            "更新所有模组到最新版本",
        ];
    }
    // 7. 模组冲突
    else if (error_lower.contains("mod") || error_lower.contains("fabric") || error_lower.contains("forge"))
        && (error_lower.contains("conflict") || error_lower.contains("duplicate") || error_lower.contains("incompatible")) {
        reason = "模组冲突".to_string();
        details = "检测到模组之间存在冲突".to_string();
        suggestions = vec![
            "检查是否安装了重复的模组",
            "查看哪些模组之间不兼容",
            "尝试二分法排查问题模组",
        ];
    }
    // 8. Forge/Fabric 加载错误
    else if (error_lower.contains("forge") || error_lower.contains("fml")) 
        && (error_lower.contains("error") || error_lower.contains("failed") || error_lower.contains("exception")) {
        reason = "Forge 加载错误".to_string();
        details = "Forge 模组加载器启动失败".to_string();
        suggestions = vec![
            "确保 Forge 版本与游戏版本匹配",
            "尝试重新安装 Forge",
            "检查是否有不兼容的模组",
            "确保 Java 版本正确",
        ];
    }
    else if error_lower.contains("fabric") && (error_lower.contains("error") || error_lower.contains("failed")) {
        reason = "Fabric 加载错误".to_string();
        details = "Fabric 模组加载器启动失败".to_string();
        suggestions = vec![
            "确保 Fabric 版本与游戏版本匹配",
            "检查是否安装了 Fabric API",
            "检查模组是否与 Fabric 版本兼容",
        ];
    }
    // 9. 文件缺失
    else if error_lower.contains("filenotfoundexception") 
        || error_lower.contains("nosuchfileexception")
        || error_lower.contains("file not found")
        || error_text.contains("FileNotFoundException")
        || error_text.contains("NoSuchFileException") {
        reason = "游戏文件缺失".to_string();
        
        // 尝试提取缺失的文件名
        for line in error_logs.iter() {
            if line.contains("FileNotFoundException") || line.contains("NoSuchFileException") {
                details = format!("文件缺失: {}", line);
                break;
            }
        }
        if details.starts_with("退出码") {
            details = "部分游戏文件丢失或损坏".to_string();
        }
        
        suggestions = vec![
            "尝试重新下载游戏版本",
            "检查游戏目录是否完整",
            "确保杀毒软件没有删除游戏文件",
            "检查磁盘空间是否充足",
        ];
    }
    // 10. 权限问题
    else if error_lower.contains("access denied") 
        || error_lower.contains("permission denied")
        || error_lower.contains("accessdeniedexception") {
        reason = "权限不足".to_string();
        details = "游戏没有足够的权限访问某些文件或目录".to_string();
        suggestions = vec![
            "尝试以管理员身份运行启动器",
            "检查游戏目录的权限设置",
            "确保杀毒软件没有阻止游戏运行",
            "尝试将游戏安装到其他目录",
        ];
    }
    // 11. 网络错误
    else if error_lower.contains("connection") && (error_lower.contains("refused") || error_lower.contains("timeout") || error_lower.contains("reset")) {
        reason = "网络连接问题".to_string();
        details = "无法连接到游戏服务器或下载资源".to_string();
        suggestions = vec![
            "检查网络连接",
            "如果使用正版登录，检查 Minecraft 服务器状态",
            "尝试使用 VPN 或更换网络",
        ];
    }
    // 12. 通用 Java 异常
    else if error_text.contains("Exception") || error_text.contains("Error") {
        reason = "游戏崩溃".to_string();
        
        // 尝试提取异常信息
        for line in error_logs.iter().rev() {
            if (line.contains("Exception") || line.contains("Error")) && !line.contains("at ") {
                details = line.clone();
                break;
            }
        }
        
        suggestions = vec![
            "查看完整的错误日志了解详情",
            "尝试重新启动游戏",
            "如果问题持续，尝试重新安装游戏",
            "检查是否有模组导致问题",
        ];
    }
    // 13. 未知错误
    else {
        suggestions = vec![
            "查看游戏日志了解详情",
            "尝试重新启动游戏",
            "检查游戏文件是否完整",
            "尝试使用不同的 Java 版本",
        ];
    }
    
    serde_json::json!({
        "reason": reason,
        "details": details,
        "suggestions": suggestions,
        "exitCode": exit_code
    })
}



// 进程监控任务 - 监控游戏进程状态，当所有游戏退出时恢复窗口
pub async fn start_process_monitor(
    app_handle: tauri::AppHandle,
    state: Arc<Mutex<crate::state::AppState>>,
) {
    use tauri::Emitter;
    use tauri::Manager;
    
    let mut was_running = false;
    let mut hidden_by_behavior = false;
    
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        let app_state = state.lock().await;
        let mut instances = app_state.running_instances.write().await;
        let launcher_behavior = app_state.launcher_settings.launcher_behavior.clone();
        
        // 检查每个进程是否存活
        let mut running_count = 0;
        let mut exited_pids = Vec::new();
        
        for (pid, inst) in instances.iter_mut() {
            if inst.exited {
                continue;
            }
            
            if is_process_alive(*pid) {
                running_count += 1;
            } else {
                println!("[Monitor] Process {} ({}) has exited", pid, inst.version_id);
                inst.exited = true;
                exited_pids.push((*pid, inst.version_id.clone()));
            }
        }
        
        // 发送退出事件
        for (pid, version_id) in &exited_pids {
            let _ = app_handle.emit("instance-exited", serde_json::json!({
                "pid": pid,
                "versionId": version_id
            }));
        }
        
        drop(instances);
        drop(app_state);
        
        let is_running = running_count > 0;
        
        // 检测状态变化
        if was_running && !is_running {
            // 所有游戏都退出了
            println!("[Monitor] All games have exited, running_count: {}", running_count);
            
            // 如果是 hide-when-game-front 模式，恢复窗口
            if launcher_behavior == "hide-when-game-front" && hidden_by_behavior {
                println!("[Monitor] Restoring window (hide-when-game-front mode)");
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                hidden_by_behavior = false;
            }
            
            // 发送游戏全部退出事件
            let _ = app_handle.emit("all-games-exited", serde_json::json!({}));
        } else if !was_running && is_running {
            // 游戏刚开始运行
            println!("[Monitor] Game started running");
            
            // 如果是 hide-when-game-front 模式，标记为已隐藏
            if launcher_behavior == "hide-when-game-front" {
                hidden_by_behavior = true;
            }
        }
        
        was_running = is_running;
    }
}

// 导出崩溃报告压缩包
#[tauri::command]
pub async fn export_crash_report(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    save_path: String,
) -> Result<serde_json::Value, String> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    
    let app_state = state.lock().await;
    
    // 获取崩溃数据
    let crash_data = app_state.last_crash_data.clone()
        .ok_or("没有崩溃数据")?;
    
    let version_id = crash_data["versionId"].as_str().unwrap_or("unknown");
    let exit_code = crash_data["exitCode"].as_i64().unwrap_or(-1);
    let crash_info = &crash_data["crashInfo"];
    let error_logs: Vec<String> = crash_data["errorLogs"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    
    // 获取设置
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    let java_path = app_state.launcher_settings.java_path.clone()
        .unwrap_or_else(|| "java".to_string());
    
    // 获取版本特定设置
    let version_settings = app_state.launcher_settings.version_settings.get(version_id);
    let effective_java = version_settings
        .and_then(|vs| vs.java_path.clone())
        .unwrap_or_else(|| java_path.clone());
    let memory_min = version_settings
        .and_then(|vs| vs.memory_min)
        .unwrap_or(app_state.launcher_settings.memory.min);
    let memory_max = version_settings
        .and_then(|vs| vs.memory_max)
        .unwrap_or(app_state.launcher_settings.memory.max);
    
    // 创建 ZIP 文件
    let file = std::fs::File::create(&save_path)
        .map_err(|e| format!("无法创建文件: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    
    // 1. 生成启动脚本
    let launch_script = generate_launch_script_content(
        &mc_dir,
        version_id,
        &effective_java,
        memory_min,
        memory_max,
    );
    
    zip.start_file("launch_script.bat", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(launch_script.as_bytes())
        .map_err(|e| e.to_string())?;
    
    // 2. 崩溃分析报告
    let crash_report = format!(
        r#"╔══════════════════════════════════════════════════════════════════╗
║              ImagineLauncher 崩溃报告                            ║
╚══════════════════════════════════════════════════════════════════╝

导出时间: {}
游戏版本: {}
退出码: {}

═══════════════════════════════════════════════════════════════════
                           崩溃分析
═══════════════════════════════════════════════════════════════════

崩溃原因: {}
详细信息: {}

解决建议:
{}

═══════════════════════════════════════════════════════════════════
                         启动器设置
═══════════════════════════════════════════════════════════════════

Minecraft 目录: {}
Java 路径: {}
内存设置: {}MB - {}MB

═══════════════════════════════════════════════════════════════════
                           系统信息
═══════════════════════════════════════════════════════════════════

{}

"#,
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        version_id,
        exit_code,
        crash_info["reason"].as_str().unwrap_or("未知"),
        crash_info["details"].as_str().unwrap_or("-"),
        crash_info["suggestions"]
            .as_array()
            .map(|arr| arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| format!("  • {}", s))
                .collect::<Vec<_>>()
                .join("\n"))
            .unwrap_or_default(),
        mc_dir,
        effective_java,
        memory_min,
        memory_max,
        get_system_info(),
    );
    
    zip.start_file("crash_report.txt", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(crash_report.as_bytes())
        .map_err(|e| e.to_string())?;
    
    // 3. 游戏错误日志 (从崩溃数据)
    if !error_logs.is_empty() {
        zip.start_file("game_stderr.log", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(error_logs.join("\n").as_bytes())
            .map_err(|e| e.to_string())?;
    }
    
    // 4. 读取 MC 的 latest.log
    let logs_dir = Path::new(&mc_dir).join("logs");
    println!("[Export] Logs dir: {:?}, exists: {}", logs_dir, logs_dir.exists());
    
    let latest_log_path = logs_dir.join("latest.log");
    println!("[Export] latest.log path: {:?}, exists: {}", latest_log_path, latest_log_path.exists());
    
    if latest_log_path.exists() {
        match std::fs::read_to_string(&latest_log_path) {
            Ok(content) => {
                println!("[Export] Read latest.log, size: {} bytes", content.len());
                zip.start_file("logs/latest.log", options)
                    .map_err(|e| e.to_string())?;
                zip.write_all(content.as_bytes())
                    .map_err(|e| e.to_string())?;
            }
            Err(e) => {
                println!("[Export] Failed to read latest.log: {}", e);
            }
        }
    }
    
    // 4.1 读取 FML 日志 (Forge)
    let fml_log_path = logs_dir.join("fml-client-latest.log");
    if fml_log_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&fml_log_path) {
            println!("[Export] Read fml-client-latest.log, size: {} bytes", content.len());
            zip.start_file("logs/fml-client-latest.log", options)
                .map_err(|e| e.to_string())?;
            zip.write_all(content.as_bytes())
                .map_err(|e| e.to_string())?;
        }
    }
    
    // 4.2 读取最近的压缩日志 (最新的 .log.gz)
    if logs_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&logs_dir) {
            let mut gz_files: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().extension()
                        .map(|ext| ext == "gz")
                        .unwrap_or(false)
                })
                .collect();
            
            // 按修改时间排序，取最新的
            gz_files.sort_by(|a, b| {
                let time_a = a.metadata().and_then(|m| m.modified()).ok();
                let time_b = b.metadata().and_then(|m| m.modified()).ok();
                time_b.cmp(&time_a)
            });
            
            // 取最新的 3 个压缩日志
            for gz_file in gz_files.iter().take(3) {
                let filename = gz_file.file_name().to_string_lossy().to_string();
                if let Ok(content) = std::fs::read(gz_file.path()) {
                    println!("[Export] Adding compressed log: {}", filename);
                    zip.start_file(format!("logs/{}", filename), options)
                        .map_err(|e| e.to_string())?;
                    zip.write_all(&content)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    
    // 5. 读取 MC 的 crash-reports 目录下最新的崩溃报告
    let crash_reports_dir = Path::new(&mc_dir).join("crash-reports");
    if crash_reports_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&crash_reports_dir) {
            let mut crash_files: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|ext| ext == "txt").unwrap_or(false))
                .collect();
            
            // 按修改时间排序，取最新的
            crash_files.sort_by(|a, b| {
                let time_a = a.metadata().and_then(|m| m.modified()).ok();
                let time_b = b.metadata().and_then(|m| m.modified()).ok();
                time_b.cmp(&time_a)
            });
            
            if let Some(latest_crash) = crash_files.first() {
                if let Ok(content) = std::fs::read_to_string(latest_crash.path()) {
                    let filename = latest_crash.file_name().to_string_lossy().to_string();
                    zip.start_file(format!("crash-reports/{}", filename), options)
                        .map_err(|e| e.to_string())?;
                    zip.write_all(content.as_bytes())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    
    // 6. 版本 JSON 文件
    let version_json_path = Path::new(&mc_dir)
        .join("versions")
        .join(version_id)
        .join(format!("{}.json", version_id));
    if version_json_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&version_json_path) {
            zip.start_file(format!("version_{}.json", version_id), options)
                .map_err(|e| e.to_string())?;
            zip.write_all(content.as_bytes())
                .map_err(|e| e.to_string())?;
        }
    }
    
    // 7. 启动器设置
    let settings_json = serde_json::to_string_pretty(&app_state.launcher_settings)
        .unwrap_or_default();
    zip.start_file("launcher_settings.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(settings_json.as_bytes())
        .map_err(|e| e.to_string())?;
    
    // 8. Mods 列表 (如果存在)
    let mods_dir = Path::new(&mc_dir).join("mods");
    if mods_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&mods_dir) {
            let mods_list: Vec<String> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|ext| ext == "jar").unwrap_or(false))
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect();
            
            if !mods_list.is_empty() {
                let mods_content = format!(
                    "已安装的 Mods ({} 个):\n\n{}",
                    mods_list.len(),
                    mods_list.join("\n")
                );
                zip.start_file("mods_list.txt", options)
                    .map_err(|e| e.to_string())?;
                zip.write_all(mods_content.as_bytes())
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    
    zip.finish().map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "path": save_path
    }))
}

// Tauri 命令：生成启动脚本
#[tauri::command]
pub async fn generate_launch_script(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    version_id: String,
    save_path: String,
) -> Result<serde_json::Value, String> {
    let app_state = state.lock().await;
    
    let mc_dir = app_state.launcher_settings.minecraft_dir.clone()
        .unwrap_or_else(|| get_default_mc_dir().to_string_lossy().to_string());
    
    // 获取版本特定设置
    let version_settings = app_state.launcher_settings.version_settings.get(&version_id);
    
    let java_path = version_settings
        .and_then(|vs| vs.java_path.clone())
        .or_else(|| app_state.launcher_settings.java_path.clone())
        .unwrap_or_else(|| "java".to_string());
    
    let memory_min = version_settings
        .and_then(|vs| vs.memory_min)
        .unwrap_or(app_state.launcher_settings.memory.min);
    let memory_max = version_settings
        .and_then(|vs| vs.memory_max)
        .unwrap_or(app_state.launcher_settings.memory.max);
    
    let script_content = generate_launch_script_content(
        &mc_dir,
        &version_id,
        &java_path,
        memory_min,
        memory_max,
    );
    
    // 写入文件
    std::fs::write(&save_path, script_content)
        .map_err(|e| format!("无法写入文件: {}", e))?;
    
    Ok(serde_json::json!({
        "success": true,
        "path": save_path
    }))
}

// 内部函数：生成启动脚本内容
fn generate_launch_script_content(
    mc_dir: &str,
    version_id: &str,
    java_path: &str,
    memory_min: u32,
    memory_max: u32,
) -> String {
    let mc_path = Path::new(mc_dir);
    let versions_dir = mc_path.join("versions");
    let version_dir = versions_dir.join(version_id);
    let json_path = version_dir.join(format!("{}.json", version_id));
    let natives_dir = version_dir.join("natives");
    
    // 读取版本 JSON
    let version_json: serde_json::Value = std::fs::read_to_string(&json_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default();
    
    // 合并继承链
    let merged = merge_version_chain(mc_dir, &version_json).unwrap_or(version_json);
    
    // 构建 classpath
    let classpath = build_classpath(mc_dir, version_id, &merged).unwrap_or_default();
    
    let main_class = merged["mainClass"].as_str().unwrap_or("net.minecraft.client.main.Main");
    
    // 构建脚本
    format!(
        r#"@echo off
REM ═══════════════════════════════════════════════════════════════════
REM ImagineLauncher 生成的启动脚本
REM 版本: {}
REM 生成时间: {}
REM ═══════════════════════════════════════════════════════════════════

REM 设置工作目录
cd /d "{}"

REM Java 路径
set JAVA_PATH="{}"

REM 内存设置
set MIN_MEMORY={}M
set MAX_MEMORY={}M

REM Natives 目录
set NATIVES_DIR="{}"

REM Classpath
set CLASSPATH={}

REM 主类
set MAIN_CLASS={}

REM 启动命令
"%JAVA_PATH%" ^
    -Xms%MIN_MEMORY% ^
    -Xmx%MAX_MEMORY% ^
    -XX:+UnlockExperimentalVMOptions ^
    -XX:+UseG1GC ^
    -Djava.library.path="%NATIVES_DIR%" ^
    -cp "%CLASSPATH%" ^
    %MAIN_CLASS% ^
    --username Player ^
    --version {} ^
    --gameDir "{}" ^
    --assetsDir "{}\assets" ^
    --assetIndex {} ^
    --accessToken 0 ^
    --userType legacy

pause
"#,
        version_id,
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        mc_dir,
        java_path,
        memory_min,
        memory_max,
        natives_dir.display(),
        classpath,
        main_class,
        version_id,
        mc_dir,
        mc_dir,
        merged["assets"].as_str().unwrap_or(version_id),
    )
}

// 获取系统信息
fn get_system_info() -> String {
    use sysinfo::System;
    
    let mut sys = System::new_all();
    sys.refresh_all();
    
    let total_memory = sys.total_memory() / 1024 / 1024;
    let used_memory = sys.used_memory() / 1024 / 1024;
    let cpu_count = sys.cpus().len();
    
    let os_name = System::name().unwrap_or_else(|| "Unknown".to_string());
    let os_version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
    let kernel_version = System::kernel_version().unwrap_or_else(|| "Unknown".to_string());
    
    format!(
        r#"操作系统: {} {}
内核版本: {}
CPU 核心数: {}
总内存: {} MB
已用内存: {} MB
可用内存: {} MB"#,
        os_name,
        os_version,
        kernel_version,
        cpu_count,
        total_memory,
        used_memory,
        total_memory - used_memory,
    )
}

