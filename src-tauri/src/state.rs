use std::path::PathBuf;
use std::sync::Mutex;

use todolisto_core::{Settings, Store};

use crate::paths;

pub struct AppState {
    pub store: Store,
    pub settings_path: PathBuf,
    pub settings: Mutex<Settings>,
    pub portable: bool,
}

impl AppState {
    pub fn init() -> Result<AppState, String> {
        let paths = paths::resolve()?;
        std::fs::create_dir_all(&paths.root)
            .map_err(|e| format!("cannot create the data folder {}: {e}", paths.root.display()))?;

        let settings_path = paths.root.join("config").join("settings.json");
        let settings = Settings::load(&settings_path).map_err(|e| e.to_string())?;
        if !settings_path.exists() {
            settings.save(&settings_path).map_err(|e| e.to_string())?;
        }

        Ok(AppState {
            store: Store::new(paths.root),
            settings_path,
            settings: Mutex::new(settings),
            portable: paths.portable,
        })
    }

    /// Name of this machine as recorded in the sessions it starts.
    pub fn device_name(&self) -> String {
        let configured = self
            .settings
            .lock()
            .ok()
            .and_then(|s| s.device_name.clone())
            .filter(|d| !d.trim().is_empty());
        configured.unwrap_or_else(default_device_name)
    }
}

fn default_device_name() -> String {
    ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
        .unwrap_or_else(|| "unknown-device".to_string())
}
