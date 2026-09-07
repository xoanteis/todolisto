// In-browser backend with the same rules as the Rust store. Used when the UI
// runs outside Tauri (`npm run dev` in a browser, end-to-end tests). State is
// kept in localStorage so a page reload behaves like restarting the app.

import { digestOf, proposalFromTags, type Proposal, type Selection } from "../model/agent";
import { renderMarkdown, searchSessions } from "../model/search";
import { extractTags } from "../model/tags";
import { ulid } from "../model/ulid";
import {
  MAX_OPACITY,
  MIN_OPACITY,
  type AgentStatus,
  type Backend,
  type DriveStatus,
  type Pending,
  type EndReason,
  type Entry,
  type Session,
  type SessionSummary,
  type Settings,
  type WindowState,
} from "./types";

const STORAGE_KEY = "todolisto.memory.v1";

interface Data {
  settings: Settings;
  sessions: Record<string, Session[]>;
  userWords?: Record<string, string[]>;
  pending?: Record<string, Pending[]>;
  done?: Record<string, Record<string, string>>;
  agentKey?: string;
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    active_profile: "work",
    profiles: [
      { id: "work", name: "Work", color: "#3b82f6", drive: false },
      { id: "personal", name: "Personal", color: "#10b981", drive: false },
    ],
    inactivity_minutes: 90,
    languages: ["en", "es", "gl"],
    theme: "system",
    device_name: null,
    hotkey: "Ctrl+Alt+N",
    opacity: 90,
    always_on_top: false,
    close_to_tray: true,
    hide_on_escape: true,
    spellcheck: true,
    autocorrect: "safe",
    google_client_id: "",
    google_client_secret: "",
    agent_enabled: true,
    agent_auto: true,
    agent_model: "claude-opus-5",
  };
}

const clone = <T>(value: T): T => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)));

function normalize(entry: Entry): Entry {
  const text = entry.text.replace(/\r\n?/g, "\n").replace(/[\n \t]+$/, "");
  return { ...entry, text, tags: extractTags(text), edited: entry.edited ?? null };
}

function lastActivity(session: Session): string {
  let last = session.header.started;
  for (const e of session.entries) {
    if (Date.parse(e.ts) > Date.parse(last)) last = e.ts;
    if (e.edited && Date.parse(e.edited) > Date.parse(last)) last = e.edited;
  }
  return last;
}

function firstLine(text: string): string {
  const line = (text.split("\n")[0] ?? "").trim();
  return line.length > 100 ? `${line.slice(0, 100).trimEnd()}…` : line;
}

function summary(s: Session): SessionSummary {
  return {
    id: s.header.id,
    profile: s.header.profile,
    started: s.header.started,
    ended: s.end?.ended ?? null,
    title: s.end?.title ?? s.header.title ?? null,
    entries: s.entries.length,
    todos: s.entries.filter((e) => e.tags.includes("todo")).length,
    first_line: s.entries.length ? firstLine(s.entries[0].text) : null,
    open: !s.end,
    reason: s.end?.reason ?? null,
    device: s.header.device,
  };
}

const byStarted = (a: Session, b: Session) => Date.parse(a.header.started) - Date.parse(b.header.started);

export function createMemoryBackend(storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage): Backend {
  let data: Data = load();

  function load(): Data {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Data;
        parsed.settings = { ...defaultSettings(), ...parsed.settings };
        return parsed;
      }
    } catch {
      // ignore corrupt storage; start fresh
    }
    return { settings: defaultSettings(), sessions: {} };
  }

  function persist() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // storage may be unavailable (private mode); keep going in memory
    }
  }

  const list = (profile: string): Session[] => (data.sessions[profile] ??= []);

  function find(profile: string, id: string): Session {
    const s = list(profile).find((x) => x.header.id === id);
    if (!s) throw new Error(`session ${id} not found`);
    return s;
  }

  function remove(profile: string, id: string) {
    data.sessions[profile] = list(profile).filter((x) => x.header.id !== id);
  }

  function openOf(profile: string): Session | null {
    const open = list(profile).filter((s) => !s.end).sort(byStarted);
    return open.length ? open[open.length - 1] : null;
  }

  function endSession(profile: string, id: string, ended: string, reason: EndReason): Session | null {
    const s = find(profile, id);
    if (s.end) throw new Error(`session ${id} is already closed`);
    if (s.entries.length === 0) {
      remove(profile, id);
      persist();
      return null;
    }
    const last = lastActivity(s);
    s.end = {
      ended: Date.parse(ended) < Date.parse(last) ? last : ended,
      entries: s.entries.length,
      title: s.header.title,
      reason,
    };
    persist();
    return s;
  }

  function addPending(profile: string, session: Session): Proposal {
    const proposal = proposalFromTags(session);
    data.pending ??= {};
    const list = (data.pending[profile] ??= []).filter((p) => p.session_id !== session.header.id);
    list.unshift({ session_id: session.header.id, proposal, created: new Date().toISOString() });
    data.pending[profile] = list;
    persist();
    return proposal;
  }

  function agentStatus(): AgentStatus {
    return { enabled: data.settings.agent_enabled, auto: data.settings.agent_auto, model: data.settings.agent_model, has_key: Boolean(data.agentKey) };
  }

  function pick<T>(list: T[], indexes: number[]): T[] {
    return indexes.map((i) => list[i]).filter((x): x is T => x !== undefined);
  }

  function autoClose(profile: string, now: string): Session | null {
    const minutes = data.settings.inactivity_minutes;
    if (!minutes) return null;
    const open = openOf(profile);
    if (!open) return null;
    const last = lastActivity(open);
    if (Date.parse(last) + minutes * 60_000 > Date.parse(now)) return null;
    return endSession(profile, open.header.id, last, "inactivity");
  }

  function windowState(): WindowState {
    const s = data.settings;
    return {
      opacity: s.opacity,
      pinned: s.always_on_top,
      hotkey: s.hotkey,
      hotkey_error: null,
      close_to_tray: s.close_to_tray,
      hide_on_escape: s.hide_on_escape,
    };
  }

  return {
    async appInfo() {
      return { version: "dev", data_root: "browser storage", portable: false, device: "browser" };
    },
    async getSettings() {
      return clone(data.settings);
    },
    async saveSettings(settings) {
      data.settings = { ...defaultSettings(), ...clone(settings) };
      persist();
      return clone(data.settings);
    },
    async setActiveProfile(profile) {
      if (!data.settings.profiles.some((p) => p.id === profile)) throw new Error(`unknown profile ${profile}`);
      data.settings.active_profile = profile;
      persist();
      return clone(data.settings);
    },
    async windowState() {
      return windowState();
    },
    async setOpacity(percent) {
      data.settings.opacity = Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Math.round(percent)));
      persist();
      return windowState();
    },
    async setPinned(pinned) {
      data.settings.always_on_top = pinned;
      persist();
      return windowState();
    },
    async hideWindow() {
      // nothing to hide in a browser tab
    },
    async getUserWords(profile) {
      return [...(data.userWords?.[profile] ?? [])];
    },
    async addUserWord(profile, word) {
      const trimmed = word.trim();
      if (!trimmed || /\s/.test(trimmed)) throw new Error("a dictionary word cannot be empty or contain spaces");
      data.userWords ??= {};
      const words = (data.userWords[profile] ??= []);
      if (!words.includes(trimmed)) words.push(trimmed);
      persist();
      return [...words];
    },
    async getAutocorrectRules() {
      return {};
    },
    async search(profile, query) {
      return searchSessions([...list(profile)].sort(byStarted), query);
    },
    async sessionMarkdown(profile, id) {
      return renderMarkdown(find(profile, id));
    },
    async driveStatus(profile): Promise<DriveStatus> {
      const s = data.settings;
      return {
        configured: Boolean(s.google_client_id && s.google_client_secret),
        enabled: s.profiles.find((p) => p.id === profile)?.drive ?? false,
        connected: false,
        account: null,
        syncing: false,
        last_sync: null,
        last_error: null,
        last_report: null,
      };
    },
    async driveConnect() {
      throw new Error("Google sign-in is only available in the desktop app");
    },
    async driveDisconnect(profile) {
      const p = data.settings.profiles.find((x) => x.id === profile);
      if (p) p.drive = false;
      persist();
      return this.driveStatus(profile);
    },
    async driveSyncNow() {
      throw new Error("Sync is only available in the desktop app");
    },
    onSyncStatus() {
      return () => {};
    },
    onDataChanged() {
      return () => {};
    },
    async agentStatus() {
      return agentStatus();
    },
    async agentSetKey(key) {
      data.agentKey = key.trim() || undefined;
      persist();
      return agentStatus();
    },
    async agentRun(profile, id) {
      return clone(addPending(profile, find(profile, id)));
    },
    async agentPending(profile) {
      return clone(data.pending?.[profile] ?? []);
    },
    async agentApply(profile, id, proposal: Proposal, selection: Selection) {
      const s = find(profile, id);
      const title = selection.title?.trim();
      if (title) {
        s.header.title = title;
        if (s.end) s.end.title = title;
      }
      s.actions.push({
        type: "agent",
        entry: null,
        at: new Date().toISOString(),
        data: {
          source: proposal.source,
          summary: selection.summary ? proposal.summary : null,
          todos: pick(proposal.todos, selection.todos),
          facts: pick(proposal.facts, selection.facts),
          questions: pick(proposal.questions, selection.questions),
          decisions: pick(proposal.decisions, selection.decisions),
          ideas: pick(proposal.ideas, selection.ideas),
        },
      });
      if (data.pending?.[profile]) data.pending[profile] = data.pending[profile].filter((p) => p.session_id !== id);
      persist();
      return this.agentDigest(profile);
    },
    async agentDiscard(profile, id) {
      if (data.pending?.[profile]) data.pending[profile] = data.pending[profile].filter((p) => p.session_id !== id);
      persist();
    },
    async agentDigest(profile) {
      return digestOf([...list(profile)].sort(byStarted), data.done?.[profile] ?? {});
    },
    async todoSetDone(profile, id, done) {
      data.done ??= {};
      const map = (data.done[profile] ??= {});
      if (done) map[id] = new Date().toISOString();
      else delete map[id];
      persist();
      return this.agentDigest(profile);
    },
    onAgentProposal() {
      return () => {};
    },
    onAgentError() {
      return () => {};
    },
    async getStream(profile, now) {
      autoClose(profile, now);
      const sessions = [...list(profile)].sort(byStarted).map(summary);
      return { open: clone(openOf(profile)), sessions };
    },
    async readSession(profile, id) {
      return clone(find(profile, id));
    },
    async startSession(profile, started) {
      const open = openOf(profile);
      if (open) return clone(open);
      const session: Session = {
        header: {
          id: ulid(),
          profile,
          started,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          title: null,
          app: "todolisto/dev",
          device: "browser",
        },
        entries: [],
        end: null,
        actions: [],
      };
      list(profile).push(session);
      persist();
      return clone(session);
    },
    async saveEntries(profile, id, entries) {
      const s = find(profile, id);
      if (s.end) throw new Error(`session ${id} is already closed`);
      s.entries = entries.map(normalize).filter((e) => e.text.trim() !== "");
      persist();
      return clone(s);
    },
    async endSession(profile, id, ended, reason) {
      const closed = endSession(profile, id, ended, reason);
      if (closed && data.settings.agent_enabled && data.settings.agent_auto) {
        addPending(profile, closed);
      }
      return clone(closed);
    },
    async reopenSession(profile, id) {
      const s = find(profile, id);
      if (!s.end) throw new Error(`session ${id} is still open`);
      const open = openOf(profile);
      if (open) {
        if (open.entries.length === 0) remove(profile, open.header.id);
        else throw new Error("another session is open with entries; close it before reopening an older one");
      }
      s.end = null;
      persist();
      return clone(s);
    },
    async checkInactivity(profile, now) {
      return clone(autoClose(profile, now));
    },
  };
}
