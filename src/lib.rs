mod accounts;
mod config;
mod downloads;
mod launcher;
mod minecraft;
mod mods;
mod state;

use state::AppState;
use std::sync::Arc;
use tauri::{Emitter, Listener, Manager};
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    dotenv::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let app_state = AppState::new(app.handle().clone())?;
            let state = Arc::new(Mutex::new(app_state));
            app.manage(state.clone());
            
            // 处理 deep link 回调
            let app_handle = app.handle().clone();
            let auth_state = state.clone();
            app.listen("deep-link://new-url", move |event: tauri::Event| {
                let payload = event.payload();
                println!("[Deep Link] Received: {}", payload);
                
                // 解析 URL 获取 code
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(payload) {
                    if let Some(url_str) = urls.first() {
                        if url_str.contains("code=") {
                            println!("[Deep Link] Found auth callback URL");
                            let app_handle = app_handle.clone();
                            let auth_state = auth_state.clone();
                            let url_str = url_str.clone();
                            
                            tauri::async_runtime::spawn(async move {
                                // 处理认证回调
                                match handle_auth_callback(&auth_state, &url_str).await {
                                    Ok(result) => {
                                        println!("[Deep Link] Auth success: {:?}", result);
                                        let _ = app_handle.emit("auth-success", result);
                                    }
                                    Err(e) => {
                                        println!("[Deep Link] Auth error: {}", e);
                                        let _ = app_handle.emit("auth-error", e);
                                    }
                                }
                            });
                        }
                    }
                }
            });
            
            // 启动游戏进程监控任务
            let app_handle = app.handle().clone();
            let monitor_state = state.clone();
            tauri::async_runtime::spawn(async move {
                minecraft::start_process_monitor(app_handle, monitor_state).await;
            });
            
            // 创建系统托盘
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                
                let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                
                let _tray = TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("ImagineLauncher")
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "show" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click { .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 窗口控制
            window_minimize,
            window_maximize,
            window_close,
            // 配置
            get_config,
            save_config,
            // 账户管理
            accounts::get_accounts,
            accounts::add_offline_account,
            accounts::remove_account,
            accounts::switch_account,
            accounts::update_account_username,
            accounts::microsoft_login,
            accounts::manual_auth_callback,
            accounts::refresh_microsoft_account,
            accounts::get_account_avatar,
            accounts::refresh_account_avatar,
            // 皮肤管理
            accounts::select_skin_file,
            accounts::set_offline_skin,
            accounts::get_skin_path,
            // 启动器设置
            launcher::get_launcher_settings,
            launcher::save_launcher_settings,
            launcher::get_default_minecraft_dir,
            launcher::validate_minecraft_dir,
            launcher::select_minecraft_dir,
            launcher::set_minecraft_dir,
            launcher::get_minecraft_dir,
            launcher::get_system_memory,
            // Java 管理
            launcher::detect_java,
            launcher::select_java_path,
            launcher::set_java_path,
            launcher::get_java_path,
            launcher::get_required_java_version,
            // 版本管理
            minecraft::scan_versions,
            minecraft::get_version_info,
            minecraft::rename_version,
            // 游戏启动
            minecraft::launch_game,
            minecraft::get_game_status,
            minecraft::kill_game,
            minecraft::get_running_instances,
            minecraft::get_instance_logs,
            minecraft::kill_instance,
            minecraft::check_duplicate_instance,
            // 启动器行为
            launcher::get_launcher_behavior,
            launcher::set_launcher_behavior,
            launcher::execute_launcher_behavior,
            launcher::get_instances_layout,
            launcher::set_instances_layout,
            // 崩溃报告
            get_crash_report_data,
            minecraft::export_crash_report,
            minecraft::generate_launch_script,
            // 下载管理
            downloads::download_minecraft_version,
            downloads::install_fabric,
            downloads::install_forge,
            downloads::install_quilt,
            downloads::open_url,
            downloads::get_forge_mc_versions,
            downloads::get_forge_versions,
            downloads::complete_game_files,
            // Mods 管理
            mods::scan_mods,
            mods::toggle_mod,
            mods::delete_mod,
            mods::add_mod,
            mods::copy_mod_to_dir,
            mods::open_folder,
            // 存档管理
            mods::scan_worlds,
            mods::delete_world,
            // 资源包管理
            mods::scan_resourcepacks,
            // 文件操作
            mods::delete_file,
            mods::copy_file_to_dir,
            // OptiFine 管理
            mods::get_optifine_versions,
            mods::download_optifine,
            mods::install_optifine,
            mods::test_optifine_api,
            mods::download_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// 处理 deep link 认证回调
async fn handle_auth_callback(
    state: &Arc<Mutex<AppState>>,
    callback_url: &str,
) -> Result<serde_json::Value, String> {
    println!("[Auth Callback] Processing URL: {}", callback_url);
    
    // 解析 URL 获取 code
    let url = url::Url::parse(callback_url).map_err(|e| e.to_string())?;
    
    let code = url.query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .ok_or("未找到授权码")?;
    
    println!("[Auth Callback] Found code: {}...", &code[..code.len().min(20)]);
    
    // 调用 accounts 模块完成认证
    let account = accounts::complete_auth_with_code(&code).await?;
    
    let mut app_state = state.lock().await;
    
    // 检查是否已存在
    let existing_idx = app_state.accounts_data.accounts.iter()
        .position(|a| a.id == account.id);
    
    if let Some(idx) = existing_idx {
        app_state.accounts_data.accounts[idx] = account.clone();
    } else {
        app_state.accounts_data.accounts.push(account.clone());
    }
    
    app_state.accounts_data.current_account = Some(account.id.clone());
    app_state.save_accounts().map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "account": account,
        "currentAccount": app_state.accounts_data.current_account
    }))
}

// ═══════════════════════════════════════════════════════════
// 窗口控制命令
// ═══════════════════════════════════════════════════════════

#[tauri::command]
async fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
async fn window_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
async fn window_close(window: tauri::Window) {
    let _ = window.close();
}

// ═══════════════════════════════════════════════════════════
// 配置命令
// ═══════════════════════════════════════════════════════════

#[tauri::command]
async fn get_config(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<config::AppConfig, String> {
    let state = state.lock().await;
    let config = state.config.clone();
    println!("[Config] get_config called");
    println!("[Config] Theme preset: {:?}", config.theme.preset);
    println!("[Config] Theme accent_color: {:?}", config.theme.accent_color);
    Ok(config)
}

#[tauri::command]
async fn save_config(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    new_config: config::AppConfig,
) -> Result<serde_json::Value, String> {
    println!("[Config] ========== save_config called ==========");
    println!("[Config] App name: {}", new_config.app.name);
    println!("[Config] App language: {}", new_config.app.language);
    println!("[Config] Theme preset: {:?}", new_config.theme.preset);
    println!("[Config] Theme accent_color: {:?}", new_config.theme.accent_color);
    println!("[Config] Theme gradient_colors: {:?}", new_config.theme.gradient_colors);
    
    let mut state = state.lock().await;
    state.config = new_config.clone();
    
    println!("[Config] Saving to disk...");
    state.save_config().map_err(|e| {
        println!("[Config] Save error: {}", e);
        e.to_string()
    })?;
    
    println!("[Config] Config saved successfully to disk");
    Ok(serde_json::json!({ "success": true }))
}

// ═══════════════════════════════════════════════════════════
// 崩溃报告命令
// ═══════════════════════════════════════════════════════════

#[tauri::command]
async fn get_crash_report_data(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Option<serde_json::Value>, String> {
    let state = state.lock().await;
    Ok(state.last_crash_data.clone())
}
