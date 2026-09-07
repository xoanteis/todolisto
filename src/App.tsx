import { useCallback, useEffect, useRef, useState } from "react";

import { createBackend } from "./backend";
import { errorMessage, type AppInfo, type Entry, type Session, type SessionSummary, type Settings } from "./backend/types";
import { Header } from "./components/Header";
import { SessionList } from "./components/SessionList";
import { Editor } from "./editor/Editor";
import { formatDay, nowIso, timeOf } from "./model/time";

const backend = createBackend();
const SAVE_DELAY_MS = 400;
const INACTIVITY_POLL_MS = 60_000;
const TOAST_MS = 4_000;

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState("");
  const [open, setOpen] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [docKey, setDocKey] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const openRef = useRef<Session | null>(null);
  const profileRef = useRef("");
  const pendingRef = useRef<Entry[] | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const setOpenSession = useCallback((session: Session | null) => {
    openRef.current = session;
    setOpen(session);
  }, []);

  /** Loads the open session and the history of a profile and rebuilds the editor. */
  const loadStream = useCallback(
    async (p: string) => {
      const stream = await backend.getStream(p, nowIso());
      if (profileRef.current !== p) return;
      setOpenSession(stream.open);
      setSessions(stream.sessions);
      setDocKey(`${p}:${stream.open?.header.id ?? "new"}:${Date.now()}`);
    },
    [setOpenSession],
  );

  useEffect(() => {
    (async () => {
      try {
        const [appInfo, loaded] = await Promise.all([backend.appInfo(), backend.getSettings()]);
        setInfo(appInfo);
        setSettings(loaded);
        profileRef.current = loaded.active_profile;
        setProfile(loaded.active_profile);
        await loadStream(loaded.active_profile);
      } catch (e) {
        setFatal(errorMessage(e));
      }
    })();
  }, [loadStream]);

  const persist = useCallback(
    async (p: string, entries: Entry[]) => {
      let session = openRef.current;
      if (!session) {
        if (entries.length === 0) return;
        session = await backend.startSession(p, entries[0].ts);
      }
      const saved = await backend.saveEntries(p, session.header.id, entries);
      if (profileRef.current === p) setOpenSession(saved);
    },
    [setOpenSession],
  );

  /** Writes any pending entries; resolves when the last write finished. */
  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(saveTimer.current);
    const entries = pendingRef.current;
    pendingRef.current = null;
    if (entries) {
      const p = profileRef.current;
      chainRef.current = chainRef.current
        .then(() => persist(p, entries))
        .catch((e) => showToast(`Could not save: ${errorMessage(e)}`));
    }
    return chainRef.current;
  }, [persist, showToast]);

  const onChange = useCallback(
    (entries: Entry[]) => {
      pendingRef.current = entries;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const switchProfile = useCallback(
    async (p: string) => {
      if (p === profileRef.current) return;
      await flush();
      profileRef.current = p;
      setProfile(p);
      setSettings((current) => {
        if (!current) return current;
        const next = { ...current, active_profile: p };
        backend.saveSettings(next).catch((e) => showToast(errorMessage(e)));
        return next;
      });
      try {
        await loadStream(p);
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [flush, loadStream, showToast],
  );

  const endSession = useCallback(async () => {
    await flush();
    const p = profileRef.current;
    const session = openRef.current;
    if (!session || session.entries.length === 0) {
      showToast("Nothing to close: write something first");
      return;
    }
    try {
      await backend.endSession(p, session.header.id, nowIso(), "manual");
      setOpenSession(null);
      await loadStream(p);
      showToast("Session ended · Ctrl+Shift+Enter reopens it");
    } catch (e) {
      showToast(errorMessage(e));
    }
  }, [flush, loadStream, setOpenSession, showToast]);

  const lastClosed = [...sessions].reverse().find((s) => !s.open) ?? null;

  const reopen = useCallback(async () => {
    await flush();
    const p = profileRef.current;
    if (!lastClosed) {
      showToast("No closed session to reopen");
      return;
    }
    try {
      await backend.reopenSession(p, lastClosed.id);
      await loadStream(p);
      showToast(`Reopened the session of ${formatDay(lastClosed.started)} ${timeOf(lastClosed.started)}`);
    } catch (e) {
      showToast(errorMessage(e));
    }
  }, [flush, lastClosed, loadStream, showToast]);

  // Inactivity rule: checked every minute and whenever the window regains focus.
  useEffect(() => {
    const minutes = settings?.inactivity_minutes ?? 0;
    const check = async () => {
      const p = profileRef.current;
      if (!p || pendingRef.current) return;
      try {
        const closed = await backend.checkInactivity(p, nowIso());
        if (closed && profileRef.current === p) {
          pendingRef.current = null;
          await loadStream(p);
          showToast(`Session closed after ${minutes} minutes without writing · Ctrl+Shift+Enter reopens it`);
        }
      } catch (e) {
        console.warn("inactivity check failed", e);
      }
    };
    const id = window.setInterval(() => void check(), INACTIVITY_POLL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadStream, settings, showToast]);

  // Never lose the last keystrokes: write when the window goes to the background.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("blur", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("blur", onHide);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  if (fatal) {
    return (
      <div className="fatal">
        <h1>todolisto could not start</h1>
        <pre>{fatal}</pre>
      </div>
    );
  }
  if (!settings || !docKey) {
    return <div className="loading">Loading…</div>;
  }

  const closed = sessions.filter((s) => !s.open);
  const liveTitle = open
    ? `Session open since ${timeOf(open.header.started)}`
    : "New session · it starts with your first line";

  return (
    <div className="app" data-theme={settings.theme}>
      <Header
        profiles={settings.profiles}
        profile={profile}
        open={open}
        canReopen={lastClosed !== null}
        onSwitch={(p) => void switchProfile(p)}
        onEnd={() => void endSession()}
        onReopen={() => void reopen()}
      />
      <main className="stream">
        <SessionList sessions={closed} load={(id) => backend.readSession(profileRef.current, id)} />
        <section className="live" aria-label="Current session">
          <div className="live-title">{liveTitle}</div>
          <Editor entries={open?.entries ?? []} docKey={docKey} handlers={{ onChange, onEndSession: endSession, onReopen: reopen }} />
        </section>
      </main>
      <footer className="statusbar">
        <span className="status">
          {open ? `${open.entries.length} ${open.entries.length === 1 ? "entry" : "entries"}` : "nothing written yet"}
          {info ? ` · ${info.portable ? "portable" : "data"}: ${info.data_root}` : ""}
        </span>
        <span className="hints">Enter new line · Shift+Enter new entry · Ctrl+Enter end session · Ctrl+Shift+Enter reopen</span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
