use crate::accounts::Account;
use crate::config::AppConfig;
use crate::launcher::LauncherSettings;
use crate::minecraft::RunningInstance;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountsData {
    pub accounts: Vec<Account>,
    pub current_account: Option<String>,
}

impl Default for AccountsData {
    fn default() -> Self {
        Self {
            accounts: Vec::new(),
            current_account: None,
        }
    }
}

pub struct AppState {
    pub app_handle: AppHandle,
    pub data_dir: PathBuf,
    pub config: AppConfig,
    pub accounts_data: AccountsData,
    pub launcher_settings: LauncherSettings,
    pub running_instances: Arc<RwLock<HashMap<u32, RunningInstance>>>,
    pub last_crash_data: Option<serde_json::Value>,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        
        // 确保数据目录存在
        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(data_dir.join("skins"))?;
        fs::create_dir_all(data_dir.join("avatars"))?;

        // 加载配置
        let config = Self::load_config(&app_handle)?;
        
        // 加载账户数据
        let accounts_data = Self::load_accounts(&data_dir);
        
        // 加载启动器设置
        let launcher_settings = Self::load_launcher_settings(&data_dir);

        Ok(Self {
            app_handle,
            data_dir,
            config,
            accounts_data,
            launcher_settings,
            running_instances: Arc::new(RwLock::new(HashMap::new())),
            last_crash_data: None,
        })
    }

    fn load_config(app_handle: &AppHandle) -> Result<AppConfig, Box<dyn std::error::Error>> {
        // 首先尝试从数据目录加载用户保存的配置
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        
        let user_config_path = data_dir.join("config.json");
        println!("[State] Looking for user config at: {:?}", user_config_path);
        
        if user_config_path.exists() {
            if let Ok(content) = fs::read_to_string(&user_config_path) {
                println!("[State] User config content: {}", content);
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    println!("[State] Loaded user config successfully, theme preset: {:?}", config.theme.preset);
                    return Ok(config);
                } else {
                    println!("[State] Failed to parse user config JSON");
                }
            }
        }
        
        // 如果用户配置不存在，尝试从资源目录加载默认配置
        let resource_path = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?
            .join("config.json");
        
        println!("[State] Looking for resource config at: {:?}", resource_path);
        
        if resource_path.exists() {
            let content = fs::read_to_string(&resource_path)?;
            let config: AppConfig = serde_json::from_str(&content)?;
            println!("[State] Loaded resource config, theme preset: {:?}", config.theme.preset);
            return Ok(config);
        }
        
        // 返回默认配置
        println!("[State] Using default config");
        Ok(AppConfig::default())
    }

    fn load_accounts(data_dir: &PathBuf) -> AccountsData {
        let accounts_file = data_dir.join("accounts.json");
        if accounts_file.exists() {
            if let Ok(content) = fs::read_to_string(&accounts_file) {
                if let Ok(data) = serde_json::from_str::<AccountsData>(&content) {
                    // 清理损坏的账户
                    let mut data = data;
                    data.accounts.retain(|a| !a.id.is_empty() && !a.username.is_empty());
                    return data;
                }
            }
        }
        AccountsData::default()
    }

    fn load_launcher_settings(data_dir: &PathBuf) -> LauncherSettings {
        let settings_file = data_dir.join("launcher-settings.json");
        println!("[State] Loading launcher settings from: {:?}", settings_file);
        
        if settings_file.exists() {
            if let Ok(content) = fs::read_to_string(&settings_file) {
                println!("[State] Settings file content: {}", content);
                if let Ok(settings) = serde_json::from_str::<LauncherSettings>(&content) {
                    println!("[State] Loaded settings: minecraft_dir={:?}, java_path={:?}", 
                        settings.minecraft_dir, settings.java_path);
                    return settings;
                } else {
                    println!("[State] Failed to parse settings JSON");
                }
            } else {
                println!("[State] Failed to read settings file");
            }
        } else {
            println!("[State] Settings file does not exist");
        }
        
        println!("[State] Using default launcher settings");
        LauncherSettings::default()
    }

    pub fn save_config(&self) -> Result<(), Box<dyn std::error::Error>> {
        let config_file = self.data_dir.join("config.json");
        println!("[State] Saving config to: {:?}", config_file);
        let content = serde_json::to_string_pretty(&self.config)?;
        println!("[State] Config content: {}", content);
        fs::write(&config_file, &content)?;
        println!("[State] Config saved successfully");
        Ok(())
    }

    pub fn save_accounts(&self) -> Result<(), Box<dyn std::error::Error>> {
        let accounts_file = self.data_dir.join("accounts.json");
        let content = serde_json::to_string_pretty(&self.accounts_data)?;
        fs::write(accounts_file, content)?;
        Ok(())
    }

    pub fn save_launcher_settings(&self) -> Result<(), Box<dyn std::error::Error>> {
        let settings_file = self.data_dir.join("launcher-settings.json");
        println!("[State] Saving launcher settings to: {:?}", settings_file);
        let content = serde_json::to_string_pretty(&self.launcher_settings)?;
        println!("[State] Settings content: {}", content);
        fs::write(&settings_file, &content)?;
        println!("[State] Settings saved successfully");
        Ok(())
    }

    pub fn get_skins_dir(&self) -> PathBuf {
        self.data_dir.join("skins")
    }

    pub fn get_avatars_dir(&self) -> PathBuf {
        self.data_dir.join("avatars")
    }
}
