//! `config/settings.json`: profiles and preferences. No secrets live here.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::fsutil;

pub const MIN_OPACITY: u8 = 30;
pub const MAX_OPACITY: u8 = 100;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub color: String,
    /// Sync this profile with the Google Drive of a connected account.
    #[serde(default)]
    pub drive: bool,
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
    /// Global shortcut that shows or hides the window, e.g. `Ctrl+Alt+N`.
    /// An empty string disables it.
    pub hotkey: String,
    /// Window opacity in percent, `MIN_OPACITY..=MAX_OPACITY`.
    pub opacity: u8,
    pub always_on_top: bool,
    /// The close button hides the window to the tray instead of quitting.
    pub close_to_tray: bool,
    /// Escape hides the window.
    pub hide_on_escape: bool,
    /// Underline misspelled words using the bundled dictionaries.
    pub spellcheck: bool,
    /// `off`, `safe` (curated typo lists) or `aggressive` (dictionary based).
    pub autocorrect: String,
    /// OAuth client of type "Desktop app" created in Google Cloud Console.
    /// Shared by every profile; each profile signs in with its own account.
    pub google_client_id: String,
    pub google_client_secret: String,
    /// Run the session agent (needs an Anthropic API key in the secrets).
    pub agent_enabled: bool,
    /// Run it automatically when a session ends.
    pub agent_auto: bool,
    /// Claude model id used by the agent.
    pub agent_model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            version: 1,
            active_profile: "work".to_string(),
            profiles: vec![
                Profile { id: "work".into(), name: "Work".into(), color: "#3b82f6".into(), drive: false },
                Profile { id: "personal".into(), name: "Personal".into(), color: "#10b981".into(), drive: false },
            ],
            inactivity_minutes: 90,
            languages: vec!["en".into(), "es".into(), "gl".into()],
            theme: "system".to_string(),
            device_name: None,
            hotkey: "Ctrl+Alt+N".to_string(),
            opacity: 90,
            always_on_top: false,
            close_to_tray: true,
            hide_on_escape: true,
            spellcheck: true,
            autocorrect: "safe".to_string(),
            google_client_id: String::new(),
            google_client_secret: String::new(),
            agent_enabled: true,
            agent_auto: true,
            agent_model: "claude-opus-5".to_string(),
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
    /// that exists, profile ids that are safe as folder names, opacity in
    /// range, a trimmed hotkey.
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
        self.opacity = clamp_opacity(self.opacity);
        self.hotkey = self.hotkey.trim().to_string();
        if !["off", "safe", "aggressive"].contains(&self.autocorrect.as_str()) {
            self.autocorrect = "safe".to_string();
        }
        self.agent_model = self.agent_model.trim().to_string();
        if self.agent_model.is_empty() {
            self.agent_model = "claude-opus-5".to_string();
        }
        self.google_client_id = self.google_client_id.trim().to_string();
        self.google_client_secret = self.google_client_secret.trim().to_string();
        self.languages.retain(|l| ["en", "es", "gl"].contains(&l.as_str()));
        if self.languages.is_empty() {
            self.languages = Settings::default().languages;
        }
    }
}

pub fn clamp_opacity(percent: u8) -> u8 {
    percent.clamp(MIN_OPACITY, MAX_OPACITY)
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
    fn unknown_fields_and_bad_values_are_tolerated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r##"{"version":1,"active_profile":"nope","profiles":[{"id":"x y","name":"Bad","color":"#000"}],"opacity":5,"hotkey":" Ctrl+Alt+N ","future":true}"##,
        )
        .unwrap();
        let settings = Settings::load(&path).unwrap();
        assert_eq!(settings.active_profile, "work");
        assert_eq!(settings.profiles.len(), 2);
        assert_eq!(settings.opacity, MIN_OPACITY);
        assert_eq!(settings.hotkey, "Ctrl+Alt+N");
        assert!(settings.close_to_tray);
        assert_eq!(settings.autocorrect, "safe");
        assert_eq!(settings.languages, vec!["en", "es", "gl"]);
    }
}
