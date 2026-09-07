import { invoke } from "@tauri-apps/api/core";

import type { Backend } from "./types";

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
  getStream: (profile, now) => invoke("get_stream", { profile, now }),
  readSession: (profile, session_id) => invoke("read_session", { profile, session_id }),
  startSession: (profile, started) => invoke("start_session", { profile, started }),
  saveEntries: (profile, session_id, entries) => invoke("save_entries", { profile, session_id, entries }),
  endSession: (profile, session_id, ended, reason) => invoke("end_session", { profile, session_id, ended, reason }),
  reopenSession: (profile, session_id) => invoke("reopen_session", { profile, session_id }),
  checkInactivity: (profile, now) => invoke("check_inactivity", { profile, now }),
};
