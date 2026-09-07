import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Backend, DataChanged, DriveStatus, ProposalEvent } from "./types";

function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  const pending = listen<T>(event, (e) => handler(e.payload));
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}

// Argument names are snake_case on both sides (`rename_all = "snake_case"`).
export const tauriBackend: Backend = {
  appInfo: () => invoke("app_info"),
  getSettings: () => invoke("get_settings"),
  saveSettings: (settings) => invoke("save_settings", { settings }),
  setActiveProfile: (profile) => invoke("set_active_profile", { profile }),
  windowState: () => invoke("window_state"),
  setOpacity: (percent) => invoke("set_opacity", { percent }),
  setPinned: (pinned) => invoke("set_pinned", { pinned }),
  hideWindow: () => invoke("hide_window"),
  getUserWords: (profile) => invoke("get_user_words", { profile }),
  addUserWord: (profile, word) => invoke("add_user_word", { profile, word }),
  getAutocorrectRules: (profile) => invoke("get_autocorrect_rules", { profile }),
  search: (profile, query) => invoke("search", { profile, query }),
  sessionMarkdown: (profile, session_id) => invoke("session_markdown", { profile, session_id }),
  driveStatus: (profile) => invoke("drive_status", { profile }),
  driveConnect: (profile) => invoke("drive_connect", { profile }),
  driveDisconnect: (profile) => invoke("drive_disconnect", { profile }),
  driveSyncNow: (profile) => invoke("drive_sync_now", { profile }),
  onSyncStatus: (handler) => subscribe<{ profile: string; status: DriveStatus }>("sync:status", (e) => handler(e.profile, e.status)),
  onDataChanged: (handler) => subscribe<DataChanged>("data:changed", handler),
  agentStatus: () => invoke("agent_status"),
  agentSetKey: (key) => invoke("agent_set_key", { key }),
  agentRun: (profile, session_id) => invoke("agent_run", { profile, session_id }),
  agentPending: (profile) => invoke("agent_pending", { profile }),
  agentApply: (profile, session_id, proposal, selection) => invoke("agent_apply", { profile, session_id, proposal, selection }),
  agentDiscard: (profile, session_id) => invoke("agent_discard", { profile, session_id }),
  agentDigest: (profile) => invoke("agent_digest", { profile }),
  todoSetDone: (profile, id, done) => invoke("todo_set_done", { profile, id, done }),
  onAgentProposal: (handler) => subscribe<ProposalEvent>("agent:proposal", handler),
  onAgentError: (handler) => subscribe<{ profile: string; session_id: string; error: string }>("agent:error", handler),
  getStream: (profile, now) => invoke("get_stream", { profile, now }),
  readSession: (profile, session_id) => invoke("read_session", { profile, session_id }),
  startSession: (profile, started) => invoke("start_session", { profile, started }),
  saveEntries: (profile, session_id, entries) => invoke("save_entries", { profile, session_id, entries }),
  endSession: (profile, session_id, ended, reason) => invoke("end_session", { profile, session_id, ended, reason }),
  reopenSession: (profile, session_id) => invoke("reopen_session", { profile, session_id }),
  checkInactivity: (profile, now) => invoke("check_inactivity", { profile, now }),
};
