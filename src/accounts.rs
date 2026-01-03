use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: String,
    #[serde(rename = "type", alias = "account_type")]
    pub account_type: String,
    pub username: String,
    pub uuid: String,
    #[serde(default, alias = "accessToken")]
    pub access_token: Option<String>,
    #[serde(default, alias = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub skin: Option<String>,
    #[serde(default, alias = "createdAt")]
    pub created_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountsResponse {
    pub accounts: Vec<Account>,
    pub current_account: Option<String>,
}


#[tauri::command]
pub async fn get_accounts(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<AccountsResponse, String> {
    let state = state.lock().await;
    Ok(AccountsResponse {
        accounts: state.accounts_data.accounts.clone(),
        current_account: state.accounts_data.current_account.clone(),
    })
}

#[tauri::command]
pub async fn add_offline_account(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    username: String,
) -> Result<serde_json::Value, String> {
    if username.trim().len() < 3 {
        return Ok(serde_json::json!({
            "success": false,
            "error": "用户名至少需要3个字符"
        }));
    }

    let uuid = Uuid::new_v4().to_string().replace("-", "");
    let account = Account {
        id: uuid.clone(),
        account_type: "offline".to_string(),
        username: username.trim().to_string(),
        uuid: uuid.clone(),
        access_token: None,
        refresh_token: None,
        skin: None,
        created_at: Some(chrono::Utc::now().timestamp_millis()),
    };

    let mut state = state.lock().await;
    state.accounts_data.accounts.push(account.clone());
    
    if state.accounts_data.current_account.is_none() {
        state.accounts_data.current_account = Some(account.id.clone());
    }
    
    state.save_accounts().map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "account": account,
        "currentAccount": state.accounts_data.current_account
    }))
}


#[tauri::command]
pub async fn remove_account(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let mut state = state.lock().await;
    
    let index = state.accounts_data.accounts.iter()
        .position(|a| a.id == account_id);
    
    if index.is_none() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "账户不存在"
        }));
    }
    
    state.accounts_data.accounts.remove(index.unwrap());
    
    if state.accounts_data.current_account.as_ref() == Some(&account_id) {
        state.accounts_data.current_account = state.accounts_data.accounts
            .first()
            .map(|a| a.id.clone());
    }
    
    state.save_accounts().map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "accounts": state.accounts_data.accounts,
        "currentAccount": state.accounts_data.current_account
    }))
}

#[tauri::command]
pub async fn switch_account(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let mut state = state.lock().await;
    
    let exists = state.accounts_data.accounts.iter().any(|a| a.id == account_id);
    if !exists {
        return Ok(serde_json::json!({
            "success": false,
            "error": "账户不存在"
        }));
    }
    
    state.accounts_data.current_account = Some(account_id.clone());
    state.save_accounts().map_err(|e| e.to_string())?;
    
    Ok(serde_json::json!({
        "success": true,
        "currentAccount": account_id
    }))
}


#[tauri::command]
pub async fn update_account_username(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
    new_username: String,
) -> Result<serde_json::Value, String> {
    let mut state = state.lock().await;
    
    let account = state.accounts_data.accounts.iter_mut()
        .find(|a| a.id == account_id);
    
    match account {
        None => Ok(serde_json::json!({
            "success": false,
            "error": "账户不存在"
        })),
        Some(acc) => {
            if acc.account_type != "offline" {
                return Ok(serde_json::json!({
                    "success": false,
                    "error": "只能修改离线账户的用户名"
                }));
            }
            acc.username = new_username.trim().to_string();
            let account_clone = acc.clone();
            state.save_accounts().map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "success": true,
                "account": account_clone
            }))
        }
    }
}

// 微软登录 - 启动本地服务器接收回调
#[tauri::command]
pub async fn microsoft_login(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    
    println!("[Microsoft Login] Starting login flow...");
    
    let client_id = std::env::var("AZURE_CLIENT_ID")
        .unwrap_or_else(|_| "d0c7a28a-ec25-4910-97ef-5cdabade8891".to_string());
    let redirect_uri = std::env::var("REDIRECT_URI")
        .unwrap_or_else(|_| "http://localhost:23456/auth/callback".to_string());
    
    println!("[Microsoft Login] Client ID: {}", client_id);
    println!("[Microsoft Login] Redirect URI: {}", redirect_uri);
    
    let oauth_state = uuid::Uuid::new_v4().to_string();
    let scope = "XboxLive.signin offline_access";
    
    let auth_url = format!(
        "https://login.live.com/oauth20_authorize.srf?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}&prompt=select_account",
        client_id,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
        oauth_state
    );
    
    println!("[Microsoft Login] Auth URL: {}", auth_url);
    
    // 启动本地 HTTP 服务器等待回调
    let server = tiny_http::Server::http("127.0.0.1:23456").map_err(|e| {
        println!("[Microsoft Login] Failed to start server: {}", e);
        format!("无法启动本地服务器: {}", e)
    })?;
    
    println!("[Microsoft Login] Local server started on port 23456");
    
    // 打开浏览器
    if let Err(e) = open::that(&auth_url) {
        println!("[Microsoft Login] Failed to open browser: {}", e);
        return Err(format!("无法打开浏览器: {}", e));
    }
    println!("[Microsoft Login] Browser opened successfully");
    
    // 等待回调（设置超时）
    let state_clone = state.inner().clone();
    let app_handle_clone = app_handle.clone();
    
    // 在新线程中等待回调
    let result = tokio::task::spawn_blocking(move || {
        println!("[Microsoft Login] Waiting for callback...");
        
        // 使用 recv_timeout 设置超时 5 分钟
        match server.recv_timeout(std::time::Duration::from_secs(300)) {
            Ok(Some(request)) => {
                let url = request.url().to_string();
                println!("[Microsoft Login] Received request: {}", url);
                
                // 解析 code
                if let Some(code) = url.split("code=").nth(1).and_then(|s| s.split('&').next()) {
                    let code = urlencoding::decode(code).unwrap_or_default().to_string();
                    println!("[Microsoft Login] Got authorization code");
                    
                    // 读取成功页面
                    let html = std::fs::read_to_string("auth-pages/success.html")
                        .unwrap_or_else(|_| "<html><body><h1>登录成功</h1><p>可以关闭此页面</p></body></html>".to_string());
                    
                    let response = tiny_http::Response::from_string(html)
                        .with_header(
                            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
                        );
                    let _ = request.respond(response);
                    
                    return Ok(code);
                } else if url.contains("error=") {
                    let error = url.split("error_description=").nth(1)
                        .and_then(|s| s.split('&').next())
                        .map(|s| urlencoding::decode(s).unwrap_or_default().to_string())
                        .unwrap_or_else(|| "登录被取消".to_string());
                    
                    // 读取错误页面
                    let html = std::fs::read_to_string("auth-pages/error.html")
                        .unwrap_or_else(|_| "<html><body><h1>登录失败</h1><p>请重试</p></body></html>".to_string());
                    
                    let response = tiny_http::Response::from_string(html)
                        .with_header(
                            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
                        );
                    let _ = request.respond(response);
                    
                    return Err(error);
                }
                
                Err("无效的回调".to_string())
            }
            Ok(None) => {
                println!("[Microsoft Login] Timeout waiting for callback");
                Err("等待登录超时".to_string())
            }
            Err(e) => {
                println!("[Microsoft Login] Server error: {}", e);
                Err(format!("服务器错误: {}", e))
            }
        }
    }).await.map_err(|e| e.to_string())?;
    
    let code = result?;
    
    // 完成认证
    println!("[Microsoft Login] Completing authentication...");
    let account = complete_microsoft_auth(&code).await?;
    
    // 保存账户
    let mut app_state = state_clone.lock().await;
    let existing_idx = app_state.accounts_data.accounts.iter()
        .position(|a| a.id == account.id);
    
    if let Some(idx) = existing_idx {
        app_state.accounts_data.accounts[idx] = account.clone();
    } else {
        app_state.accounts_data.accounts.push(account.clone());
    }
    
    app_state.accounts_data.current_account = Some(account.id.clone());
    app_state.save_accounts().map_err(|e| e.to_string())?;
    
    println!("[Microsoft Login] Login successful: {}", account.username);
    
    // 通知前端
    let _ = app_handle_clone.emit("auth-success", serde_json::json!({
        "account": &account
    }));
    
    Ok(serde_json::json!({
        "success": true,
        "account": account,
        "currentAccount": app_state.accounts_data.current_account
    }))
}


// 处理手动输入的授权回调URL
#[tauri::command]
pub async fn manual_auth_callback(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    callback_url: String,
) -> Result<serde_json::Value, String> {
    println!("[Manual Auth] Received callback URL: {}", callback_url);
    
    // 解析URL获取code
    let url = url::Url::parse(&callback_url)
        .map_err(|e| {
            println!("[Manual Auth] URL parse error: {}", e);
            "无效的回调URL".to_string()
        })?;
    
    let code = url.query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .ok_or_else(|| {
            println!("[Manual Auth] No code found in URL");
            "未找到授权码".to_string()
        })?;
    
    println!("[Manual Auth] Found authorization code: {}...", &code[..code.len().min(20)]);
    
    // 完成认证流程
    let account = complete_microsoft_auth(&code).await?;
    println!("[Manual Auth] Auth completed, account: {} ({})", account.username, account.id);
    
    let mut app_state = state.lock().await;
    
    // 检查是否已存在
    let existing_idx = app_state.accounts_data.accounts.iter()
        .position(|a| a.id == account.id);
    
    if let Some(idx) = existing_idx {
        println!("[Manual Auth] Updating existing account at index {}", idx);
        app_state.accounts_data.accounts[idx] = account.clone();
    } else {
        println!("[Manual Auth] Adding new account");
        app_state.accounts_data.accounts.push(account.clone());
    }
    
    app_state.accounts_data.current_account = Some(account.id.clone());
    app_state.save_accounts().map_err(|e| {
        println!("[Manual Auth] Save error: {}", e);
        e.to_string()
    })?;
    
    println!("[Manual Auth] Account saved successfully");
    
    Ok(serde_json::json!({
        "success": true,
        "account": account,
        "currentAccount": app_state.accounts_data.current_account
    }))
}

// 公开的认证函数，供 lib.rs 调用
pub async fn complete_auth_with_code(code: &str) -> Result<Account, String> {
    complete_microsoft_auth(code).await
}

async fn complete_microsoft_auth(code: &str) -> Result<Account, String> {
    println!("[MS Auth] Starting authentication with code...");
    
    let client_id = std::env::var("AZURE_CLIENT_ID")
        .unwrap_or_else(|_| "d0c7a28a-ec25-4910-97ef-5cdabade8891".to_string());
    let redirect_uri = std::env::var("REDIRECT_URI")
        .unwrap_or_else(|_| "http://localhost:23456/auth/callback".to_string());
    
    let client = reqwest::Client::new();
    
    // 1. 获取 Microsoft Token
    println!("[MS Auth] Step 1: Getting Microsoft token...");
    let ms_token: serde_json::Value = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", client_id.as_str()),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| {
            println!("[MS Auth] Token request failed: {}", e);
            e.to_string()
        })?
        .json()
        .await
        .map_err(|e| {
            println!("[MS Auth] Token parse failed: {}", e);
            e.to_string()
        })?;
    
    if ms_token.get("error").is_some() {
        let error_desc = ms_token["error_description"]
            .as_str()
            .unwrap_or("获取Token失败");
        println!("[MS Auth] Token error: {}", error_desc);
        return Err(error_desc.to_string());
    }
    
    let access_token = ms_token["access_token"].as_str().ok_or_else(|| {
        println!("[MS Auth] No access_token in response");
        "无效的access_token".to_string()
    })?;
    let refresh_token = ms_token["refresh_token"].as_str().map(|s| s.to_string());
    println!("[MS Auth] Got Microsoft token successfully");
    
    // 2-4. Xbox Live -> XSTS -> Minecraft Token
    println!("[MS Auth] Step 2-4: Getting Minecraft token...");
    let mc_data = get_minecraft_token(access_token).await?;
    println!("[MS Auth] Got Minecraft token successfully");
    
    // 5. 获取 Minecraft Profile
    println!("[MS Auth] Step 5: Getting Minecraft profile...");
    let profile = get_minecraft_profile(&mc_data.access_token).await?;
    println!("[MS Auth] Got profile: {} ({})", profile.name, profile.id);
    
    Ok(Account {
        id: profile.id.clone(),
        account_type: "microsoft".to_string(),
        username: profile.name,
        uuid: profile.id,
        access_token: Some(mc_data.access_token),
        refresh_token,
        skin: profile.skin_url,
        created_at: Some(chrono::Utc::now().timestamp_millis()),
    })
}


struct MinecraftTokenData {
    access_token: String,
}

struct MinecraftProfile {
    id: String,
    name: String,
    skin_url: Option<String>,
}

async fn get_minecraft_token(ms_access_token: &str) -> Result<MinecraftTokenData, String> {
    let client = reqwest::Client::new();
    
    // Xbox Live 认证
    println!("[MC Token] Getting Xbox Live token...");
    let xbl_response: serde_json::Value = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={}", ms_access_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| {
            println!("[MC Token] XBL request failed: {}", e);
            e.to_string()
        })?
        .json()
        .await
        .map_err(|e| {
            println!("[MC Token] XBL parse failed: {}", e);
            e.to_string()
        })?;
    
    let xbl_token = xbl_response["Token"].as_str().ok_or_else(|| {
        println!("[MC Token] No XBL token in response: {:?}", xbl_response);
        "无效的XBL Token".to_string()
    })?;
    println!("[MC Token] Got XBL token");
    
    // XSTS Token
    println!("[MC Token] Getting XSTS token...");
    let xsts_response: serde_json::Value = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| {
            println!("[MC Token] XSTS request failed: {}", e);
            e.to_string()
        })?
        .json()
        .await
        .map_err(|e| {
            println!("[MC Token] XSTS parse failed: {}", e);
            e.to_string()
        })?;
    
    // 检查 XSTS 错误
    if let Some(xerr) = xsts_response.get("XErr") {
        let error_code = xerr.as_u64().unwrap_or(0);
        let error_msg = match error_code {
            2148916233 => "此账户没有 Xbox 账户，请先创建一个",
            2148916235 => "Xbox Live 在您的国家/地区不可用",
            2148916236 | 2148916237 => "此账户需要成人验证（韩国）",
            2148916238 => "此账户是未成年人账户，需要添加到家庭组",
            _ => "Xbox Live 认证失败",
        };
        println!("[MC Token] XSTS error {}: {}", error_code, error_msg);
        return Err(error_msg.to_string());
    }
    
    let xsts_token = xsts_response["Token"].as_str().ok_or_else(|| {
        println!("[MC Token] No XSTS token in response: {:?}", xsts_response);
        "无效的XSTS Token".to_string()
    })?;
    let uhs = xsts_response["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .ok_or_else(|| {
            println!("[MC Token] No UHS in response");
            "无效的UHS".to_string()
        })?;
    println!("[MC Token] Got XSTS token");
    
    // Minecraft Token
    println!("[MC Token] Getting Minecraft token...");
    let mc_response: serde_json::Value = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)
        }))
        .send()
        .await
        .map_err(|e| {
            println!("[MC Token] MC token request failed: {}", e);
            e.to_string()
        })?
        .json()
        .await
        .map_err(|e| {
            println!("[MC Token] MC token parse failed: {}", e);
            e.to_string()
        })?;
    
    let mc_token = mc_response["access_token"]
        .as_str()
        .ok_or_else(|| {
            println!("[MC Token] No MC token in response: {:?}", mc_response);
            "无效的Minecraft Token".to_string()
        })?
        .to_string();
    
    println!("[MC Token] Got Minecraft token successfully");
    Ok(MinecraftTokenData { access_token: mc_token })
}


async fn get_minecraft_profile(mc_token: &str) -> Result<MinecraftProfile, String> {
    println!("[MC Profile] Getting Minecraft profile...");
    let client = reqwest::Client::new();
    
    let profile: serde_json::Value = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", mc_token))
        .send()
        .await
        .map_err(|e| {
            println!("[MC Profile] Request failed: {}", e);
            e.to_string()
        })?
        .json()
        .await
        .map_err(|e| {
            println!("[MC Profile] Parse failed: {}", e);
            e.to_string()
        })?;
    
    if profile.get("error").is_some() || profile.get("errorMessage").is_some() {
        let error_msg = profile["errorMessage"].as_str()
            .or(profile["error"].as_str())
            .unwrap_or("无法获取Minecraft账户信息");
        println!("[MC Profile] Error: {}", error_msg);
        return Err("无法获取Minecraft账户信息，可能未购买游戏".to_string());
    }
    
    let id = profile["id"].as_str().ok_or_else(|| {
        println!("[MC Profile] No ID in response: {:?}", profile);
        "无效的Profile ID".to_string()
    })?.to_string();
    let name = profile["name"].as_str().ok_or_else(|| {
        println!("[MC Profile] No name in response");
        "无效的Profile Name".to_string()
    })?.to_string();
    let skin_url = profile["skins"]
        .as_array()
        .and_then(|skins| skins.first())
        .and_then(|skin| skin["url"].as_str())
        .map(|s| s.to_string());
    
    println!("[MC Profile] Got profile: {} ({}), skin: {:?}", name, id, skin_url.is_some());
    
    Ok(MinecraftProfile { id, name, skin_url })
}

#[tauri::command]
pub async fn refresh_microsoft_account(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let mut app_state = state.lock().await;
    
    let account = app_state.accounts_data.accounts.iter()
        .find(|a| a.id == account_id)
        .cloned();
    
    let account = match account {
        Some(a) if a.account_type == "microsoft" => a,
        _ => return Ok(serde_json::json!({
            "success": false,
            "error": "账户不存在或不是微软账户"
        })),
    };
    
    let refresh_token = account.refresh_token.as_ref()
        .ok_or("无refresh_token")?;
    
    let client_id = std::env::var("AZURE_CLIENT_ID")
        .unwrap_or_else(|_| "d0c7a28a-ec25-4910-97ef-5cdabade8891".to_string());
    
    let client = reqwest::Client::new();
    
    let ms_token: serde_json::Value = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", client_id.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    
    if ms_token.get("error").is_some() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "刷新失败"
        }));
    }
    
    let access_token = ms_token["access_token"].as_str().ok_or("无效token")?;
    let new_refresh = ms_token["refresh_token"].as_str().map(|s| s.to_string());
    
    let mc_data = get_minecraft_token(access_token).await?;
    let profile = get_minecraft_profile(&mc_data.access_token).await?;
    
    // 更新账户
    if let Some(acc) = app_state.accounts_data.accounts.iter_mut()
        .find(|a| a.id == account_id) 
    {
        acc.username = profile.name;
        acc.access_token = Some(mc_data.access_token);
        acc.refresh_token = new_refresh;
        acc.skin = profile.skin_url;
    }
    
    app_state.save_accounts().map_err(|e| e.to_string())?;
    
    let updated = app_state.accounts_data.accounts.iter()
        .find(|a| a.id == account_id)
        .cloned();
    
    Ok(serde_json::json!({
        "success": true,
        "account": updated
    }))
}


// 皮肤管理
#[tauri::command]
pub async fn select_skin_file() -> Result<serde_json::Value, String> {
    // 这个命令需要在前端使用 dialog plugin 实现
    Ok(serde_json::json!({
        "success": false,
        "error": "请使用前端dialog选择文件"
    }))
}

#[tauri::command]
pub async fn set_offline_skin(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
    skin_path: String,
) -> Result<serde_json::Value, String> {
    let mut app_state = state.lock().await;
    
    let skins_dir = app_state.get_skins_dir();
    let dest_path = skins_dir.join(format!("{}.png", account_id));
    
    let account = app_state.accounts_data.accounts.iter_mut()
        .find(|a| a.id == account_id);
    
    match account {
        None => Ok(serde_json::json!({
            "success": false,
            "error": "账户不存在"
        })),
        Some(acc) if acc.account_type != "offline" => Ok(serde_json::json!({
            "success": false,
            "error": "只能设置离线账户的皮肤"
        })),
        Some(acc) => {
            std::fs::copy(&skin_path, &dest_path)
                .map_err(|e| e.to_string())?;
            
            acc.skin = Some(dest_path.to_string_lossy().to_string());
            app_state.save_accounts().map_err(|e| e.to_string())?;
            
            Ok(serde_json::json!({
                "success": true,
                "skinPath": dest_path.to_string_lossy()
            }))
        }
    }
}

#[tauri::command]
pub async fn get_skin_path(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let app_state = state.lock().await;
    
    let account = app_state.accounts_data.accounts.iter()
        .find(|a| a.id == account_id);
    
    match account {
        None => Ok(serde_json::json!({
            "success": false,
            "error": "账户不存在"
        })),
        Some(acc) => Ok(serde_json::json!({
            "success": true,
            "skinPath": acc.skin
        })),
    }
}

#[tauri::command]
pub async fn get_account_avatar(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let app_state = state.lock().await;
    
    let avatars_dir = app_state.get_avatars_dir();
    let avatar_path = avatars_dir.join(format!("{}.png", account_id));
    
    // 尝试从皮肤提取头像（每次都重新生成以确保帽子层正确）
    let account = app_state.accounts_data.accounts.iter()
        .find(|a| a.id == account_id);
    
    if let Some(acc) = account {
        if let Some(skin) = &acc.skin {
            // 如果头像文件不存在，或者皮肤URL是网络地址（可能会更新），则重新生成
            let should_regenerate = !avatar_path.exists() || skin.starts_with("http");
            
            if should_regenerate {
                if let Ok(path) = extract_avatar(skin, &avatar_path).await {
                    return Ok(serde_json::json!({
                        "success": true,
                        "avatarPath": path
                    }));
                }
            } else if avatar_path.exists() {
                return Ok(serde_json::json!({
                    "success": true,
                    "avatarPath": avatar_path.to_string_lossy()
                }));
            }
        }
    }
    
    // 如果头像文件存在（可能是之前生成的），直接返回
    if avatar_path.exists() {
        return Ok(serde_json::json!({
            "success": true,
            "avatarPath": avatar_path.to_string_lossy()
        }));
    }
    
    Ok(serde_json::json!({
        "success": true,
        "avatarPath": null,
        "isDefault": true
    }))
}

#[tauri::command]
pub async fn refresh_account_avatar(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let app_state = state.lock().await;
    
    let avatars_dir = app_state.get_avatars_dir();
    let avatar_path = avatars_dir.join(format!("{}.png", account_id));
    
    // 删除旧头像
    let _ = std::fs::remove_file(&avatar_path);
    
    let account = app_state.accounts_data.accounts.iter()
        .find(|a| a.id == account_id);
    
    if let Some(acc) = account {
        if let Some(skin) = &acc.skin {
            if let Ok(path) = extract_avatar(skin, &avatar_path).await {
                return Ok(serde_json::json!({
                    "success": true,
                    "avatarPath": path
                }));
            }
        }
    }
    
    Ok(serde_json::json!({
        "success": true,
        "avatarPath": null,
        "isDefault": true
    }))
}

async fn extract_avatar(skin_source: &str, dest_path: &std::path::Path) -> Result<String, String> {
    println!("[Avatar] Extracting avatar from: {}", skin_source);
    
    let img_data = if skin_source.starts_with("http") {
        reqwest::get(skin_source)
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?
            .to_vec()
    } else if std::path::Path::new(skin_source).exists() {
        std::fs::read(skin_source).map_err(|e| e.to_string())?
    } else {
        return Err("皮肤文件不存在".to_string());
    };
    
    let img = image::load_from_memory(&img_data)
        .map_err(|e| e.to_string())?;
    
    println!("[Avatar] Skin size: {}x{}", img.width(), img.height());
    
    // 皮肤缩放比例 (64x64 皮肤 scale=1, 128x128 皮肤 scale=2)
    let scale = img.width() / 64;
    
    // 提取脸部正面 (8x8 区域从 8,8 开始)
    let face = img.crop_imm(8 * scale, 8 * scale, 8 * scale, 8 * scale);
    // 提取帽子层正面 (8x8 区域从 40,8 开始)
    let hat = img.crop_imm(40 * scale, 8 * scale, 8 * scale, 8 * scale);
    
    // 输出尺寸
    let size: u32 = 64;
    // HMCL 的偏移量计算: faceOffset = size / 18.0
    let face_offset: u32 = (size as f64 / 18.0).round() as u32;  // 约等于 4
    let face_size: u32 = size - 2 * face_offset;  // 56
    
    // 创建透明画布
    let mut avatar = image::RgbaImage::new(size, size);
    
    // 放大脸部和帽子层
    let face_resized = image::imageops::resize(&face, face_size, face_size, image::imageops::FilterType::Nearest);
    let hat_resized = image::imageops::resize(&hat, size, size, image::imageops::FilterType::Nearest);
    
    // 按照 HMCL 的方式渲染：
    // 1. 先画脸部（有偏移，比画布小）
    image::imageops::overlay(&mut avatar, &face_resized, face_offset as i64, face_offset as i64);
    
    // 2. 再画帽子层（填满整个画布，覆盖在脸部上面）
    // 帽子层有透明部分，所以脸部会透过来
    for y in 0..size {
        for x in 0..size {
            let hat_pixel = hat_resized.get_pixel(x, y);
            if hat_pixel[3] > 0 {  // 只画非透明像素
                let dest_pixel = avatar.get_pixel_mut(x, y);
                // Alpha 混合
                let alpha = hat_pixel[3] as f32 / 255.0;
                let inv_alpha = 1.0 - alpha;
                dest_pixel[0] = (hat_pixel[0] as f32 * alpha + dest_pixel[0] as f32 * inv_alpha) as u8;
                dest_pixel[1] = (hat_pixel[1] as f32 * alpha + dest_pixel[1] as f32 * inv_alpha) as u8;
                dest_pixel[2] = (hat_pixel[2] as f32 * alpha + dest_pixel[2] as f32 * inv_alpha) as u8;
                dest_pixel[3] = 255;
            }
        }
    }
    
    println!("[Avatar] avatar created, size: {}x{}, faceOffset: {}", size, size, face_offset);
    
    // 确保目录存在
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    avatar.save(dest_path).map_err(|e| e.to_string())?;
    
    Ok(dest_path.to_string_lossy().to_string())
}
