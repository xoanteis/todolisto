//! Runs the sync: sign-in, token refresh, folder discovery, the core engine,
//! and the status the UI shows. Everything here blocks on the network and is
//! therefore called from worker threads only.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use todolisto_core::sync::{sync_profile, SyncReport, SyncState};

use super::api::{DriveClient, DriveRemote};
use super::oauth::{self, OAuthClient};
use super::secrets;
use crate::state::AppState;

pub const SYNC_INTERVAL: Duration = Duration::from_secs(30);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Default, Serialize)]
pub struct DriveStatus {
    /// A Google OAuth client is configured in the settings.
    pub configured: bool,
    /// The profile has sync switched on.
    pub enabled: bool,
    /// A Google account is signed in for the profile.
    pub connected: bool,
    pub account: Option<String>,
    pub syncing: bool,
    pub last_sync: Option<String>,
    pub last_error: Option<String>,
    pub last_report: Option<SyncReport>,
}

#[derive(Serialize, Clone)]
struct StatusEvent {
    profile: String,
    status: DriveStatus,
}

#[derive(Serialize, Clone)]
struct DataChanged {
    profile: String,
    sessions: bool,
    dictionary: bool,
}

#[derive(Default)]
struct Runtime {
    syncing: bool,
    last_sync: Option<String>,
    last_error: Option<String>,
    last_report: Option<SyncReport>,
}

#[derive(Default)]
pub struct SyncService {
    runtime: Mutex<HashMap<String, Runtime>>,
    /// Access tokens with their expiry, per profile.
    tokens: Mutex<HashMap<String, (String, u64)>>,
    /// Only one sync at a time, across profiles.
    busy: Mutex<()>,
}

impl SyncService {
    pub fn status(&self, state: &AppState, profile: &str) -> DriveStatus {
        let settings = state.settings();
        let secrets = secrets::load(&state.secrets_path);
        let account = secrets.accounts.get(profile);
        let runtime = self.runtime.lock().ok();
        let rt = runtime.as_ref().and_then(|r| r.get(profile));
        DriveStatus {
            configured: !settings.google_client_id.is_empty() && !settings.google_client_secret.is_empty(),
            enabled: settings.profile(profile).map(|p| p.drive).unwrap_or(false),
            connected: account.is_some(),
            account: account.and_then(|a| a.email.clone()),
            syncing: rt.map(|r| r.syncing).unwrap_or(false),
            last_sync: rt.and_then(|r| r.last_sync.clone()),
            last_error: rt.and_then(|r| r.last_error.clone()),
            last_report: rt.and_then(|r| r.last_report.clone()),
        }
    }

    fn update_runtime(&self, profile: &str, update: impl FnOnce(&mut Runtime)) {
        if let Ok(mut runtime) = self.runtime.lock() {
            update(runtime.entry(profile.to_string()).or_default());
        }
    }
}

fn oauth_client(state: &AppState) -> Result<OAuthClient, String> {
    let settings = state.settings();
    if settings.google_client_id.is_empty() || settings.google_client_secret.is_empty() {
        return Err("Add the Google OAuth client id and secret first (Sync setup)".to_string());
    }
    Ok(OAuthClient { client_id: settings.google_client_id, client_secret: settings.google_client_secret })
}

fn emit_status(app: &AppHandle, profile: &str) {
    let state = app.state::<AppState>();
    let status = state.sync.status(&state, profile);
    let _ = app.emit("sync:status", StatusEvent { profile: profile.to_string(), status });
}

/// Signs the profile in: opens the browser, stores the refresh token and
/// switches sync on for the profile.
pub fn connect(app: &AppHandle, profile: &str) -> Result<DriveStatus, String> {
    let state = app.state::<AppState>();
    let client = oauth_client(&state)?;
    let tokens = oauth::authorize_blocking(&client, SIGN_IN_TIMEOUT, &|url| {
        let _ = open::that(url);
    })?;
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| "Google did not return a refresh token; remove the app's access in your Google account and sign in again".to_string())?;

    let mut secrets = secrets::load(&state.secrets_path);
    secrets.accounts.insert(profile.to_string(), secrets::Account { refresh_token, email: tokens.email.clone() });
    secrets::save(&state.secrets_path, &secrets)?;
    if let Ok(mut cache) = state.sync.tokens.lock() {
        cache.insert(profile.to_string(), (tokens.access_token, tokens.expires_at));
    }

    let mut settings = state.settings();
    if let Some(p) = settings.profiles.iter_mut().find(|p| p.id == profile) {
        p.drive = true;
    }
    state.update_settings(settings)?;
    state.sync.update_runtime(profile, |r| r.last_error = None);
    emit_status(app, profile);
    Ok(state.sync.status(&state, profile))
}

/// Forgets the account; local files stay, nothing is deleted on Drive.
pub fn disconnect(app: &AppHandle, profile: &str) -> Result<DriveStatus, String> {
    let state = app.state::<AppState>();
    let mut secrets = secrets::load(&state.secrets_path);
    secrets.accounts.remove(profile);
    secrets::save(&state.secrets_path, &secrets)?;
    if let Ok(mut cache) = state.sync.tokens.lock() {
        cache.remove(profile);
    }
    let mut settings = state.settings();
    if let Some(p) = settings.profiles.iter_mut().find(|p| p.id == profile) {
        p.drive = false;
    }
    state.update_settings(settings)?;
    state.sync.update_runtime(profile, |r| {
        r.last_error = None;
        r.last_report = None;
    });
    emit_status(app, profile);
    Ok(state.sync.status(&state, profile))
}

fn access_token(state: &AppState, profile: &str) -> Result<String, String> {
    if let Ok(cache) = state.sync.tokens.lock() {
        if let Some((token, expires_at)) = cache.get(profile) {
            if *expires_at > oauth::now_secs() + 60 {
                return Ok(token.clone());
            }
        }
    }
    let client = oauth_client(state)?;
    let secrets = secrets::load(&state.secrets_path);
    let account = secrets
        .accounts
        .get(profile)
        .ok_or_else(|| "This profile is not connected to a Google account".to_string())?;
    let tokens = oauth::refresh_blocking(&client, &account.refresh_token)?;
    if let Ok(mut cache) = state.sync.tokens.lock() {
        cache.insert(profile.to_string(), (tokens.access_token.clone(), tokens.expires_at));
    }
    Ok(tokens.access_token)
}

fn run_sync(state: &AppState, profile: &str) -> Result<SyncReport, String> {
    let token = access_token(state, profile)?;
    let client = DriveClient::new(token)?;
    let state_path = state.store.root().join("cache").join("sync").join(format!("{profile}.json"));
    let mut sync_state = SyncState::load(&state_path);

    let root = match sync_state.folders.get("root") {
        Some(id) => id.clone(),
        None => {
            let id = client.ensure_folder("root", "todolisto")?;
            sync_state.folders.insert("root".into(), id.clone());
            id
        }
    };
    let folder = match sync_state.folders.get("profile") {
        Some(id) => id.clone(),
        None => {
            let id = client.ensure_folder(&root, profile)?;
            sync_state.folders.insert("profile".into(), id.clone());
            id
        }
    };
    let _ = sync_state.save(&state_path);

    let mut remote = DriveRemote { client, folder };
    let result = sync_profile(&state.store.profile_dir(profile), &mut remote, &mut sync_state);
    match &result {
        Ok(_) => {}
        Err(e) if e.to_string().contains("HTTP 404") => {
            // A folder vanished on Drive: forget what we knew, next round rebuilds.
            sync_state.folders.clear();
            sync_state.token = None;
        }
        Err(_) => {}
    }
    sync_state.save(&state_path).map_err(|e| e.to_string())?;
    result.map_err(|e| e.to_string())
}

/// One sync round for a profile, with status events and catalog refresh.
pub fn sync(app: &AppHandle, profile: &str) -> Result<SyncReport, String> {
    let state = app.state::<AppState>();
    let _guard = state.sync.busy.lock().map_err(|_| "sync lock poisoned".to_string())?;
    state.sync.update_runtime(profile, |r| r.syncing = true);
    emit_status(app, profile);

    let result = run_sync(&state, profile);

    let now = todolisto_core::time::format(&todolisto_core::time::now());
    match &result {
        Ok(report) => {
            state.sync.update_runtime(profile, |r| {
                r.syncing = false;
                r.last_sync = Some(now.clone());
                r.last_error = None;
                r.last_report = Some(report.clone());
            });
            let sessions = report.sessions_changed();
            let dictionary = report.pulled.iter().any(|n| n == "dictionary.txt" || n == "autocorrect.txt");
            if sessions {
                state.invalidate(profile);
            }
            if sessions || dictionary {
                let _ = app.emit("data:changed", DataChanged { profile: profile.to_string(), sessions, dictionary });
            }
        }
        Err(error) => {
            state.sync.update_runtime(profile, |r| {
                r.syncing = false;
                r.last_error = Some(error.clone());
            });
        }
    }
    emit_status(app, profile);
    result
}

/// Profiles that are enabled and signed in.
pub fn syncable_profiles(state: &AppState) -> Vec<String> {
    let settings = state.settings();
    let secrets = secrets::load(&state.secrets_path);
    settings
        .profiles
        .iter()
        .filter(|p| p.drive && secrets.accounts.contains_key(&p.id))
        .map(|p| p.id.clone())
        .collect()
}

/// Syncs a profile on a worker thread; errors land in the status.
pub fn sync_in_background(app: &AppHandle, profile: &str) {
    let app = app.clone();
    let profile = profile.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = sync(&app, &profile);
    });
}

/// Periodic sync of every connected profile while the app runs.
pub fn start_background(app: AppHandle) {
    std::thread::Builder::new()
        .name("drive-sync".into())
        .spawn(move || loop {
            std::thread::sleep(SYNC_INTERVAL);
            let profiles = {
                let state = app.state::<AppState>();
                syncable_profiles(&state)
            };
            for profile in profiles {
                let _ = sync(&app, &profile);
            }
        })
        .expect("cannot start the sync thread");
}
