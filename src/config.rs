use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub app: AppInfo,
    pub window: WindowConfig,
    pub ui: UiConfig,
    #[serde(default)]
    pub theme: ThemeConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub ui_framework_version: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
    pub border_radius: bool,
    pub radius_size: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig {
    pub scrollbar: bool,
    pub titlebar_height: u32,
    pub animations: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub gradient_colors: Option<Vec<String>>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            app: AppInfo {
                name: "ImagineLauncher".to_string(),
                version: "0.0.1".to_string(),
                ui_framework_version: Some("1.0.1".to_string()),
                channel: Some("Alpha".to_string()),
                language: "zh-CN".to_string(),
            },
            window: WindowConfig {
                width: 1000,
                height: 600,
                min_width: 800,
                min_height: 500,
                border_radius: true,
                radius_size: 12,
            },
            ui: UiConfig {
                scrollbar: false,
                titlebar_height: 48,
                animations: true,
            },
            theme: ThemeConfig {
                preset: Some("pink".to_string()),
                accent_color: Some("#f472b6".to_string()),
                gradient_colors: Some(vec![
                    "#f472b6".to_string(),
                    "#ec4899".to_string(),
                    "#db2777".to_string(),
                ]),
            },
        }
    }
}
