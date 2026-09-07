//! IPC surface used by the UI. Argument names are snake_case on both sides.

use serde::Serialize;
use tauri::State;
use todolisto_core::settings::is_safe_id;
use todolisto_core::store::NewSession;
use todolisto_core::time::{local_tz_name, parse, Timestamp};
use todolisto_core::{EndReason, Entry, Session, SessionSummary, Settings};

use crate::state::AppState;

type CmdResult<T> = Result<T, String>;

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub data_root: String,
    pub portable: bool,
    pub device: String,
}

#[derive(Serialize)]
pub struct StreamState {
    pub open: Option<Session>,
    pub sessions: Vec<SessionSummary>,
}

fn check_profile(profile: &str) -> CmdResult<()> {
    if is_safe_id(profile) {
        Ok(())
    } else {
        Err(format!("invalid profile id: {profile:?}"))
    }
}

fn parse_ts(raw: &str, what: &str) -> CmdResult<Timestamp> {
    parse(raw).map_err(|e| format!("invalid {what} timestamp {raw:?}: {e}"))
}

fn inactivity_minutes(state: &AppState) -> u32 {
    state.settings.lock().map(|s| s.inactivity_minutes).unwrap_or(0)
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_root: state.store.root().display().to_string(),
        portable: state.portable,
        device: state.device_name(),
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> CmdResult<Settings> {
    state.settings.lock().map(|s| s.clone()).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    let mut settings = settings;
    settings.validate();
    settings.save(&state.settings_path).map_err(|e| e.to_string())?;
    let mut current = state.settings.lock().map_err(|e| e.to_string())?;
    *current = settings.clone();
    Ok(settings)
}

/// Everything the UI needs for a profile. Also applies the inactivity rule,
/// so an open session that went stale while the app was closed is closed now.
#[tauri::command(rename_all = "snake_case")]
pub fn get_stream(state: State<'_, AppState>, profile: String, now: String) -> CmdResult<StreamState> {
    check_profile(&profile)?;
    let now = parse_ts(&now, "now")?;
    state
        .store
        .auto_close_if_inactive(&profile, now, inactivity_minutes(&state))
        .map_err(|e| e.to_string())?;
    let open = state.store.open_session(&profile).map_err(|e| e.to_string())?;
    let sessions = state.store.list_sessions(&profile).map_err(|e| e.to_string())?;
    Ok(StreamState { open, sessions })
}

#[tauri::command(rename_all = "snake_case")]
pub fn read_session(state: State<'_, AppState>, profile: String, session_id: String) -> CmdResult<Session> {
    check_profile(&profile)?;
    state.store.read_session(&profile, &session_id).map_err(|e| e.to_string())
}

/// Creates the open session of a profile, or returns the existing one.
#[tauri::command(rename_all = "snake_case")]
pub fn start_session(state: State<'_, AppState>, profile: String, started: String) -> CmdResult<Session> {
    check_profile(&profile)?;
    let started = parse_ts(&started, "start")?;
    if let Some(open) = state.store.open_session(&profile).map_err(|e| e.to_string())? {
        return Ok(open);
    }
    state
        .store
        .create_session(NewSession {
            profile,
            started,
            tz: local_tz_name(),
            app: format!("todolisto/{}", env!("CARGO_PKG_VERSION")),
            device: Some(state.device_name()),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn save_entries(
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
    entries: Vec<Entry>,
) -> CmdResult<Session> {
    check_profile(&profile)?;
    state
        .store
        .save_entries(&profile, &session_id, entries)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn end_session(
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
    ended: String,
    reason: EndReason,
) -> CmdResult<Option<Session>> {
    check_profile(&profile)?;
    let ended = parse_ts(&ended, "end")?;
    state
        .store
        .end_session(&profile, &session_id, ended, reason)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn reopen_session(state: State<'_, AppState>, profile: String, session_id: String) -> CmdResult<Session> {
    check_profile(&profile)?;
    state
        .store
        .reopen_session(&profile, &session_id)
        .map_err(|e| e.to_string())
}

/// Closes the open session when it has been idle for longer than the
/// configured limit. Returns the closed session, if any.
#[tauri::command(rename_all = "snake_case")]
pub fn check_inactivity(state: State<'_, AppState>, profile: String, now: String) -> CmdResult<Option<Session>> {
    check_profile(&profile)?;
    let now = parse_ts(&now, "now")?;
    state
        .store
        .auto_close_if_inactive(&profile, now, inactivity_minutes(&state))
        .map_err(|e| e.to_string())
}
