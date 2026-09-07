// Data transfer types; field names are snake_case to match the Rust core.

import type { Digest, Proposal, Selection } from "../model/agent";
import type { SearchQuery, SearchResult } from "../model/search";

export type EndReason = "manual" | "inactivity" | "taken_over";

export interface SessionHeader {
  id: string;
  profile: string;
  started: string;
  tz: string;
  title: string | null;
  app: string;
  device: string | null;
}

export interface Entry {
  id: string;
  ts: string;
  text: string;
  tags: string[];
  edited?: string | null;
}

export interface SessionEnd {
  ended: string;
  entries: number;
  title: string | null;
  reason: EndReason;
}

export interface Action {
  type: string;
  entry: string | null;
  at: string;
  data?: unknown;
}

export interface Session {
  header: SessionHeader;
  entries: Entry[];
  end: SessionEnd | null;
  actions: Action[];
}

export interface SessionSummary {
  id: string;
  profile: string;
  started: string;
  ended: string | null;
  title: string | null;
  entries: number;
  todos: number;
  first_line: string | null;
  open: boolean;
  reason: EndReason | null;
  device: string | null;
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  drive: boolean;
}

export interface Settings {
  version: number;
  active_profile: string;
  profiles: Profile[];
  inactivity_minutes: number;
  languages: string[];
  theme: "system" | "light" | "dark";
  device_name?: string | null;
  hotkey: string;
  opacity: number;
  always_on_top: boolean;
  close_to_tray: boolean;
  hide_on_escape: boolean;
  spellcheck: boolean;
  autocorrect: "off" | "safe" | "aggressive";
  google_client_id: string;
  google_client_secret: string;
  agent_enabled: boolean;
  agent_auto: boolean;
  agent_model: string;
}

export interface AgentStatus {
  enabled: boolean;
  auto: boolean;
  model: string;
  has_key: boolean;
}

export interface Pending {
  session_id: string;
  proposal: Proposal;
  created: string;
}

export interface ProposalEvent {
  profile: string;
  session_id: string;
  todos: number;
}

export interface SyncReport {
  pulled: string[];
  pushed: string[];
  conflicts: string[];
  unchanged: number;
}

export interface DriveStatus {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  account: string | null;
  syncing: boolean;
  last_sync: string | null;
  last_error: string | null;
  last_report: SyncReport | null;
}

export interface DataChanged {
  profile: string;
  sessions: boolean;
  dictionary: boolean;
}

export interface WindowState {
  opacity: number;
  pinned: boolean;
  hotkey: string;
  hotkey_error: string | null;
  close_to_tray: boolean;
  hide_on_escape: boolean;
}

export const MIN_OPACITY = 30;
export const MAX_OPACITY = 100;
export const OPACITY_STEP = 5;

export interface AppInfo {
  version: string;
  data_root: string;
  portable: boolean;
  device: string;
}

export interface StreamState {
  open: Session | null;
  sessions: SessionSummary[];
}

export interface Backend {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  setActiveProfile(profile: string): Promise<Settings>;
  windowState(): Promise<WindowState>;
  setOpacity(percent: number): Promise<WindowState>;
  setPinned(pinned: boolean): Promise<WindowState>;
  /** Hides the window (to the tray); a no-op outside the desktop app. */
  hideWindow(): Promise<void>;
  getUserWords(profile: string): Promise<string[]>;
  /** Adds a word to the profile dictionary and returns the whole list. */
  addUserWord(profile: string, word: string): Promise<string[]>;
  /** Personal autocorrect rules (`wrong` → `right`), lower-cased keys. */
  getAutocorrectRules(profile: string): Promise<Record<string, string>>;
  search(profile: string, query: SearchQuery): Promise<SearchResult>;
  /** Tags used in the profile, most used first. */
  listTags(profile: string): Promise<{ tag: string; count: number }[]>;
  sessionMarkdown(profile: string, sessionId: string): Promise<string>;
  driveStatus(profile: string): Promise<DriveStatus>;
  /** Opens the browser for the Google sign-in; resolves when it completes. */
  driveConnect(profile: string): Promise<DriveStatus>;
  driveDisconnect(profile: string): Promise<DriveStatus>;
  driveSyncNow(profile: string): Promise<SyncReport>;
  /** Live sync status; returns the unsubscribe function. */
  onSyncStatus(handler: (profile: string, status: DriveStatus) => void): () => void;
  /** Files of a profile changed on disk because of a sync. */
  onDataChanged(handler: (event: DataChanged) => void): () => void;
  agentStatus(): Promise<AgentStatus>;
  agentSetKey(key: string): Promise<AgentStatus>;
  /** Builds a proposal (Claude when a key is set, tags otherwise). */
  agentRun(profile: string, sessionId: string): Promise<Proposal>;
  agentPending(profile: string): Promise<Pending[]>;
  agentApply(profile: string, sessionId: string, proposal: Proposal, selection: Selection): Promise<Digest>;
  agentDiscard(profile: string, sessionId: string): Promise<void>;
  agentDigest(profile: string): Promise<Digest>;
  todoSetDone(profile: string, id: string, done: boolean): Promise<Digest>;
  onAgentProposal(handler: (event: ProposalEvent) => void): () => void;
  onAgentError(handler: (event: { profile: string; session_id: string; error: string }) => void): () => void;
  /** Applies the inactivity rule, then returns the open session and the list. */
  getStream(profile: string, now: string): Promise<StreamState>;
  readSession(profile: string, sessionId: string): Promise<Session>;
  /** Creates the open session of the profile or returns the existing one. */
  startSession(profile: string, started: string): Promise<Session>;
  saveEntries(profile: string, sessionId: string, entries: Entry[]): Promise<Session>;
  /** Returns null when the session was empty and therefore discarded. */
  endSession(profile: string, sessionId: string, ended: string, reason: EndReason): Promise<Session | null>;
  reopenSession(profile: string, sessionId: string): Promise<Session>;
  checkInactivity(profile: string, now: string): Promise<Session | null>;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
