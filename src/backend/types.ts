// Data transfer types; field names are snake_case to match the Rust core.

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
}

export interface Settings {
  version: number;
  active_profile: string;
  profiles: Profile[];
  inactivity_minutes: number;
  languages: string[];
  theme: "system" | "light" | "dark";
  device_name?: string | null;
}

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
