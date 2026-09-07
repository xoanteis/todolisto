//! `config/settings.json`: profiles and preferences. No secrets live here.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::fsutil;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    pub active_profile: String,
    pub profiles: Vec<Profile>,
    /// Minutes without writing after which an open session closes itself.
    /// `0` disables the automatic close.
    pub inactivity_minutes: u32,
    pub languages: Vec<String>,
    /// `system`, `light` or `dark`.
    pub theme: String,
    /// Overrides the machine name recorded in sessions started here.
    pub device_name: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            version: 1,
            active_profile: "work".to_string(),
            profiles: vec![
                Profile { id: "work".into(), name: "Work".into(), color: "#3b82f6".into() },
                Profile { id: "personal".into(), name: "Personal".into(), color: "#10b981".into() },
            ],
            inactivity_minutes: 90,
            languages: vec!["en".into(), "es".into(), "gl".into()],
            theme: "system".to_string(),
            device_name: None,
        }
    }
}

impl Settings {
    /// Loads the settings file, falling back to defaults when it does not
    /// exist. Unknown fields are ignored; missing fields take their defaults.
    pub fn load(path: &Path) -> Result<Settings> {
        if !path.exists() {
            return Ok(Settings::default());
        }
        let raw = fsutil::read_to_string(path)?;
        let mut settings: Settings = serde_json::from_str(&raw).map_err(|e| Error::Parse {
            path: path.to_path_buf(),
            line: e.line(),
            message: e.to_string(),
        })?;
        settings.validate();
        Ok(settings)
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(|e| Error::Other(e.to_string()))?;
        fsutil::atomic_write(path, format!("{json}\n").as_bytes())
    }

    pub fn profile(&self, id: &str) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    /// Repairs inconsistent values: at least one profile, an active profile
    /// that exists, non-empty profile ids that are safe as folder names.
    pub fn validate(&mut self) {
        self.profiles.retain(|p| is_safe_id(&p.id));
        if self.profiles.is_empty() {
            self.profiles = Settings::default().profiles;
        }
        if self.profile(&self.active_profile).is_none() {
            self.active_profile = self.profiles[0].id.clone();
        }
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            self.theme = "system".to_string();
        }
    }
}

/// Profile ids double as folder names, so keep them to a conservative set.
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config").join("settings.json");
        let settings = Settings::load(&path).unwrap();
        assert_eq!(settings, Settings::default());
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap(), settings);
    }

    #[test]
    fn unknown_fields_and_bad_active_profile_are_tolerated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r##"{"version":1,"active_profile":"nope","profiles":[{"id":"x y","name":"Bad","color":"#000"}],"future":true}"##,
        )
        .unwrap();
        let settings = Settings::load(&path).unwrap();
        assert_eq!(settings.active_profile, "work");
        assert_eq!(settings.profiles.len(), 2);
    }
}
