//! Runs the agent for a session and keeps the proposal until it is reviewed.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use todolisto_core::agent::{self, Proposal, Selection};
use todolisto_core::time::{format as format_ts, now};
use todolisto_core::{Digest, TodoState};

use super::client;
use crate::drive::secrets;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct AgentStatus {
    pub enabled: bool,
    pub auto: bool,
    pub model: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Pending {
    pub session_id: String,
    pub proposal: Proposal,
    pub created: String,
}

#[derive(Serialize, Clone)]
struct ProposalEvent {
    profile: String,
    session_id: String,
    todos: usize,
}

fn pending_dir(state: &AppState, profile: &str) -> PathBuf {
    state.store.root().join("cache").join("agent").join(profile)
}

fn pending_path(state: &AppState, profile: &str, session_id: &str) -> PathBuf {
    pending_dir(state, profile).join(format!("{session_id}.json"))
}

pub fn status(state: &AppState) -> AgentStatus {
    let settings = state.settings();
    let secrets = secrets::load(&state.secrets_path);
    AgentStatus {
        enabled: settings.agent_enabled,
        auto: settings.agent_auto,
        model: settings.agent_model,
        has_key: secrets.anthropic_api_key.as_deref().is_some_and(|k| !k.is_empty()),
    }
}

pub fn set_key(state: &AppState, key: &str) -> Result<AgentStatus, String> {
    let mut secrets = secrets::load(&state.secrets_path);
    let key = key.trim();
    secrets.anthropic_api_key = if key.is_empty() { None } else { Some(key.to_string()) };
    secrets::save(&state.secrets_path, &secrets)?;
    Ok(status(state))
}

fn store_pending(state: &AppState, profile: &str, session_id: &str, proposal: &Proposal) -> Result<(), String> {
    let record = serde_json::json!({ "session_id": session_id, "proposal": proposal, "created": format_ts(&now()) });
    let json = serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?;
    todolisto_core::fsutil::atomic_write(&pending_path(state, profile, session_id), &json).map_err(|e| e.to_string())
}

/// Builds the proposal for a session: with Claude when a key is set and the
/// agent is enabled, from the tags alone otherwise. Blocks on the network.
pub fn run(app: &AppHandle, profile: &str, session_id: &str) -> Result<Proposal, String> {
    let state = app.state::<AppState>();
    let session = state
        .sessions(profile)?
        .into_iter()
        .find(|s| s.header.id == session_id)
        .ok_or_else(|| format!("session {session_id} not found"))?;
    if session.entries.is_empty() {
        return Err("the session has no entries".to_string());
    }
    let settings = state.settings();
    let profile_name = settings.profile(profile).map(|p| p.name.clone()).unwrap_or_else(|| profile.to_string());
    let tagged = agent::from_tags(&session);
    let secrets = secrets::load(&state.secrets_path);

    let proposal = match secrets.anthropic_api_key.as_deref().filter(|k| !k.is_empty() && settings.agent_enabled) {
        Some(api_key) => {
            let answer = client::complete(&client::Request {
                api_key,
                model: &settings.agent_model,
                system: &agent::system_prompt(),
                user: &agent::user_message(&session, &profile_name),
                schema: agent::schema(),
            })?;
            let mut parsed = agent::parse_response(&answer.json)?;
            parsed.source = format!("claude:{}", answer.model);
            agent::merge(parsed, &tagged)
        }
        None => tagged,
    };

    store_pending(&state, profile, session_id, &proposal)?;
    let _ = app.emit("agent:proposal", ProposalEvent { profile: profile.to_string(), session_id: session_id.to_string(), todos: proposal.todos.len() });
    Ok(proposal)
}

pub fn run_in_background(app: &AppHandle, profile: &str, session_id: &str) {
    let app = app.clone();
    let profile = profile.to_string();
    let session_id = session_id.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = run(&app, &profile, &session_id) {
            let _ = app.emit("agent:error", serde_json::json!({ "profile": profile, "session_id": session_id, "error": e }));
        }
    });
}

pub fn pending(state: &AppState, profile: &str) -> Vec<Pending> {
    let dir = pending_dir(state, profile);
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<Pending> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| fs::read(e.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter_map(|v| {
            Some(Pending {
                session_id: v.get("session_id")?.as_str()?.to_string(),
                proposal: serde_json::from_value(v.get("proposal")?.clone()).ok()?,
                created: v.get("created").and_then(|c| c.as_str()).unwrap_or_default().to_string(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

pub fn discard(state: &AppState, profile: &str, session_id: &str) {
    let _ = fs::remove_file(pending_path(state, profile, session_id));
}

/// Writes the kept items into the session and forgets the proposal.
pub fn apply(state: &AppState, profile: &str, session_id: &str, proposal: &Proposal, selection: &Selection) -> Result<(), String> {
    agent::apply(&state.store, profile, session_id, proposal, selection, now()).map_err(|e| e.to_string())?;
    discard(state, profile, session_id);
    state.invalidate(profile);
    Ok(())
}

pub fn digest(state: &AppState, profile: &str) -> Result<Digest, String> {
    let sessions = state.sessions(profile)?;
    let todos = TodoState::load(&state.store.todos_path(profile));
    Ok(agent::digest(&sessions, &todos))
}

pub fn set_done(state: &AppState, profile: &str, id: &str, done: bool) -> Result<Digest, String> {
    let path = state.store.todos_path(profile);
    let mut todos = TodoState::load(&path);
    if done {
        todos.done.insert(id.to_string(), format_ts(&now()));
    } else {
        todos.done.remove(id);
    }
    todos.save(&path).map_err(|e| e.to_string())?;
    digest(state, profile)
}
