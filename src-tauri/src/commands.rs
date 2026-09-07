//! IPC surface used by the UI. Argument names are snake_case on both sides.

use std::collections::BTreeMap;

use serde::Serialize;
use tauri::{AppHandle, State};
use todolisto_core::settings::{clamp_opacity, is_safe_id};
use todolisto_core::store::NewSession;
use todolisto_core::time::{local_tz_name, parse, Timestamp};
use todolisto_core::{markdown, search, EndReason, Entry, SearchQuery, SearchResult, Session, SessionSummary, Settings};

use crate::state::AppState;
use crate::window;

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
    state.settings().inactivity_minutes
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

#[derive(Serialize)]
pub struct WindowState {
    pub opacity: u8,
    pub pinned: bool,
    pub hotkey: String,
    pub hotkey_error: Option<String>,
    pub close_to_tray: bool,
    pub hide_on_escape: bool,
}

fn window_state_of(state: &AppState) -> WindowState {
    let settings = state.settings();
    WindowState {
        opacity: settings.opacity,
        pinned: settings.always_on_top,
        hotkey: settings.hotkey.clone(),
        hotkey_error: state.hotkey_error.lock().ok().and_then(|e| e.clone()),
        close_to_tray: settings.close_to_tray,
        hide_on_escape: settings.hide_on_escape,
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

/// Replaces the whole settings file and applies what affects the window.
#[tauri::command(rename_all = "snake_case")]
pub fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    let saved = state.update_settings(settings)?;
    window::apply_settings(&app, &saved);
    Ok(saved)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_active_profile(state: State<'_, AppState>, profile: String) -> CmdResult<Settings> {
    check_profile(&profile)?;
    let mut settings = state.settings();
    if settings.profile(&profile).is_none() {
        return Err(format!("unknown profile {profile:?}"));
    }
    settings.active_profile = profile;
    state.update_settings(settings)
}

#[tauri::command]
pub fn window_state(state: State<'_, AppState>) -> WindowState {
    window_state_of(&state)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_opacity(app: AppHandle, state: State<'_, AppState>, percent: u8) -> CmdResult<WindowState> {
    let mut settings = state.settings();
    settings.opacity = clamp_opacity(percent);
    let saved = state.update_settings(settings)?;
    if let Some(window) = window::main_window(&app) {
        window::apply_opacity(&window, saved.opacity);
    }
    Ok(window_state_of(&state))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_pinned(app: AppHandle, state: State<'_, AppState>, pinned: bool) -> CmdResult<WindowState> {
    let mut settings = state.settings();
    settings.always_on_top = pinned;
    let saved = state.update_settings(settings)?;
    if let Some(window) = window::main_window(&app) {
        window::apply_pinned(&window, saved.always_on_top);
    }
    Ok(window_state_of(&state))
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    window::hide(&app);
}

/// Everything the UI needs for a profile. Also applies the inactivity rule,
/// so an open session that went stale while the app was closed is closed now.
#[tauri::command(rename_all = "snake_case")]
pub fn get_stream(state: State<'_, AppState>, profile: String, now: String) -> CmdResult<StreamState> {
    check_profile(&profile)?;
    let now = parse_ts(&now, "now")?;
    let closed = state
        .store
        .auto_close_if_inactive(&profile, now, inactivity_minutes(&state))
        .map_err(|e| e.to_string())?;
    if closed.is_some() {
        state.invalidate(&profile);
    }
    let sessions = state.sessions(&profile)?;
    let open = sessions.iter().filter(|s| s.is_open()).max_by_key(|s| s.header.started).cloned();
    Ok(StreamState { open, sessions: sessions.iter().map(Session::summary).collect() })
}

#[tauri::command(rename_all = "snake_case")]
pub fn read_session(state: State<'_, AppState>, profile: String, session_id: String) -> CmdResult<Session> {
    check_profile(&profile)?;
    state
        .sessions(&profile)?
        .into_iter()
        .find(|s| s.header.id == session_id)
        .ok_or_else(|| format!("session {session_id} not found"))
}

/// Creates the open session of a profile, or returns the existing one.
#[tauri::command(rename_all = "snake_case")]
pub fn start_session(state: State<'_, AppState>, profile: String, started: String) -> CmdResult<Session> {
    check_profile(&profile)?;
    let started = parse_ts(&started, "start")?;
    if let Some(open) = state.store.open_session(&profile).map_err(|e| e.to_string())? {
        return Ok(open);
    }
    let created = state
        .store
        .create_session(NewSession {
            profile: profile.clone(),
            started,
            tz: local_tz_name(),
            app: format!("todolisto/{}", env!("CARGO_PKG_VERSION")),
            device: Some(state.device_name()),
        })
        .map_err(|e| e.to_string())?;
    state.invalidate(&profile);
    Ok(created)
}

#[tauri::command(rename_all = "snake_case")]
pub fn save_entries(
    state: State<'_, AppState>,
    profile: String,
    session_id: String,
    entries: Vec<Entry>,
) -> CmdResult<Session> {
    check_profile(&profile)?;
    let saved = state
        .store
        .save_entries(&profile, &session_id, entries)
        .map_err(|e| e.to_string())?;
    state.invalidate(&profile);
    Ok(saved)
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
    let closed = state
        .store
        .end_session(&profile, &session_id, ended, reason)
        .map_err(|e| e.to_string())?;
    state.invalidate(&profile);
    Ok(closed)
}

#[tauri::command(rename_all = "snake_case")]
pub fn reopen_session(state: State<'_, AppState>, profile: String, session_id: String) -> CmdResult<Session> {
    check_profile(&profile)?;
    let reopened = state
        .store
        .reopen_session(&profile, &session_id)
        .map_err(|e| e.to_string())?;
    state.invalidate(&profile);
    Ok(reopened)
}

/// Closes the open session when it has been idle for longer than the
/// configured limit. Returns the closed session, if any.
#[tauri::command(rename_all = "snake_case")]
pub fn check_inactivity(state: State<'_, AppState>, profile: String, now: String) -> CmdResult<Option<Session>> {
    check_profile(&profile)?;
    let now = parse_ts(&now, "now")?;
    let closed = state
        .store
        .auto_close_if_inactive(&profile, now, inactivity_minutes(&state))
        .map_err(|e| e.to_string())?;
    if closed.is_some() {
        state.invalidate(&profile);
    }
    Ok(closed)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_user_words(state: State<'_, AppState>, profile: String) -> CmdResult<Vec<String>> {
    check_profile(&profile)?;
    state.store.user_words(&profile).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn add_user_word(state: State<'_, AppState>, profile: String, word: String) -> CmdResult<Vec<String>> {
    check_profile(&profile)?;
    state.store.add_user_word(&profile, &word).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_autocorrect_rules(state: State<'_, AppState>, profile: String) -> CmdResult<BTreeMap<String, String>> {
    check_profile(&profile)?;
    state.store.autocorrect_rules(&profile).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn search(state: State<'_, AppState>, profile: String, query: SearchQuery) -> CmdResult<SearchResult> {
    check_profile(&profile)?;
    let sessions = state.sessions(&profile)?;
    Ok(search::search(&sessions, &query))
}

/// The Markdown rendering of a session, as written next to closed ones.
#[tauri::command(rename_all = "snake_case")]
pub fn session_markdown(state: State<'_, AppState>, profile: String, session_id: String) -> CmdResult<String> {
    check_profile(&profile)?;
    let session = state
        .sessions(&profile)?
        .into_iter()
        .find(|s| s.header.id == session_id)
        .ok_or_else(|| format!("session {session_id} not found"))?;
    Ok(markdown::render(&session))
}
