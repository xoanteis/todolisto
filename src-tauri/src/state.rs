use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

use todolisto_core::{Settings, Store, WindowGeometry};

use crate::paths;

pub struct AppState {
    pub store: Store,
    pub settings_path: PathBuf,
    pub settings: Mutex<Settings>,
    pub portable: bool,
    pub geometry_path: PathBuf,
    pub geometry: Mutex<Option<WindowGeometry>>,
    pub geometry_generation: AtomicU64,
    /// Why the global hotkey could not be registered, for the UI.
    pub hotkey_error: Mutex<Option<String>>,
}

impl AppState {
    pub fn init() -> Result<AppState, String> {
        let paths = paths::resolve()?;
        std::fs::create_dir_all(&paths.root)
            .map_err(|e| format!("cannot create the data folder {}: {e}", paths.root.display()))?;

        let config_dir = paths.root.join("config");
        let settings_path = config_dir.join("settings.json");
        let settings = Settings::load(&settings_path).map_err(|e| e.to_string())?;
        if !settings_path.exists() {
            settings.save(&settings_path).map_err(|e| e.to_string())?;
        }
        let geometry_path = config_dir.join("window.json");
        let geometry = WindowGeometry::load(&geometry_path);

        Ok(AppState {
            store: Store::new(paths.root),
            settings_path,
            settings: Mutex::new(settings),
            portable: paths.portable,
            geometry_path,
            geometry: Mutex::new(geometry),
            geometry_generation: AtomicU64::new(0),
            hotkey_error: Mutex::new(None),
        })
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Stores and persists new settings.
    pub fn update_settings(&self, mut settings: Settings) -> Result<Settings, String> {
        settings.validate();
        settings.save(&self.settings_path).map_err(|e| e.to_string())?;
        let mut current = self.settings.lock().map_err(|e| e.to_string())?;
        *current = settings.clone();
        Ok(settings)
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
