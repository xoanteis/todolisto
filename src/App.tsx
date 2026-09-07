import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createBackend } from "./backend";
import {
  MAX_OPACITY,
  MIN_OPACITY,
  OPACITY_STEP,
  errorMessage,
  type AppInfo,
  type Entry,
  type Session,
  type SessionSummary,
  type Settings,
  type WindowState,
} from "./backend/types";
import { Header } from "./components/Header";
import { SearchPanel, type SearchScope } from "./components/SearchPanel";
import { SessionList, type Expanded } from "./components/SessionList";
import { Editor, type EditorHandle, type SpellOptions } from "./editor/Editor";
import type { SearchHit, SearchQuery } from "./model/search";
import { formatDay, nowIso, timeOf } from "./model/time";
import { BUILTIN_RULES } from "./spell/autocorrect";
import { SpellClient, type SpellStatus } from "./spell/client";

const backend = createBackend();
const SAVE_DELAY_MS = 400;
const INACTIVITY_POLL_MS = 60_000;
const TOAST_MS = 4_000;

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [win, setWin] = useState<WindowState | null>(null);
  const spell = useMemo(() => new SpellClient(), []);
  const [spellStatus, setSpellStatus] = useState<SpellStatus>("idle");
  const [userWords, setUserWords] = useState<string[]>([]);
  const [rules, setRules] = useState<Record<string, string>>(BUILTIN_RULES);
  const [expanded, setExpanded] = useState<Expanded>({});
  const [focusTarget, setFocusTarget] = useState<{ sessionId: string; entryId: string; nonce: number } | null>(null);
  const [searchScope, setSearchScope] = useState<SearchScope | null>(null);
  const editorRef = useRef<EditorHandle>(null);
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
      setExpanded({});
      setDocKey(`${p}:${stream.open?.header.id ?? "new"}:${Date.now()}`);
    },
    [setOpenSession],
  );

  useEffect(() => spell.onStatus(() => setSpellStatus(spell.status)), [spell]);

  // Load the dictionaries once the settings are known; reload when languages change.
  const languagesKey = settings?.languages.join(",") ?? "";
  const spellEnabled = settings?.spellcheck ?? false;
  useEffect(() => {
    if (!languagesKey) return;
    if (!spellEnabled) {
      spell.disable();
      return;
    }
    const p = profileRef.current;
    backend
      .getUserWords(p)
      .then((words) => {
        setUserWords(words);
        spell.init(languagesKey.split(","), words);
      })
      .catch((e) => showToast(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languagesKey, spellEnabled, spell]);

  // Per-profile dictionary and autocorrect rules.
  useEffect(() => {
    if (!profile) return;
    Promise.all([backend.getUserWords(profile), backend.getAutocorrectRules(profile)])
      .then(([words, personal]) => {
        setUserWords(words);
        spell.setUserWords(words);
        setRules({ ...BUILTIN_RULES, ...personal });
      })
      .catch((e) => showToast(errorMessage(e)));
  }, [profile, spell, showToast]);

  const addWord = useCallback(
    async (word: string) => {
      try {
        const words = await backend.addUserWord(profileRef.current, word);
        setUserWords(words);
        spell.addWord(word, words);
        showToast(`“${word}” added to the ${profileRef.current} dictionary`);
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [spell, showToast],
  );

  useEffect(() => {
    (async () => {
      try {
        const [appInfo, loaded, windowState] = await Promise.all([backend.appInfo(), backend.getSettings(), backend.windowState()]);
        setInfo(appInfo);
        setSettings(loaded);
        setWin(windowState);
        if (windowState.hotkey_error) showToast(windowState.hotkey_error);
        profileRef.current = loaded.active_profile;
        setProfile(loaded.active_profile);
        await loadStream(loaded.active_profile);
      } catch (e) {
        setFatal(errorMessage(e));
      }
    })();
  }, [loadStream, showToast]);

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
      try {
        setSettings(await backend.setActiveProfile(p));
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

  const setPinned = useCallback(
    async (pinned: boolean) => {
      try {
        setWin(await backend.setPinned(pinned));
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [showToast],
  );

  const setOpacity = useCallback(
    async (percent: number) => {
      const clamped = Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, percent));
      try {
        setWin(await backend.setOpacity(clamped));
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [showToast],
  );

  const winRef = useRef<WindowState | null>(null);
  winRef.current = win;

  const stepOpacity = useCallback(
    (direction: number) => {
      const current = winRef.current?.opacity ?? MAX_OPACITY;
      void setOpacity(current + direction * OPACITY_STEP);
    },
    [setOpacity],
  );

  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchScope !== null;

  const hideWindow = useCallback((): boolean => {
    if (searchOpenRef.current) {
      setSearchScope(null);
      return true;
    }
    if (!winRef.current?.hide_on_escape) return false;
    void flush().then(() => backend.hideWindow());
    return true;
  }, [flush]);

  const toggleSession = useCallback(async (id: string) => {
    if (expanded[id]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setExpanded((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const session = await backend.readSession(profileRef.current, id);
      setExpanded((prev) => ({ ...prev, [id]: session }));
    } catch (e) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      showToast(errorMessage(e));
    }
  }, [expanded, showToast]);

  const copyMarkdown = useCallback(
    async (id: string) => {
      try {
        const markdown = await backend.sessionMarkdown(profileRef.current, id);
        await navigator.clipboard.writeText(markdown);
        showToast("Session copied as Markdown");
      } catch (e) {
        showToast(`Could not copy: ${errorMessage(e)}`);
      }
    },
    [showToast],
  );

  const runSearch = useCallback((query: SearchQuery) => backend.search(profileRef.current, query), []);

  const openHit = useCallback(
    async (hit: SearchHit) => {
      setSearchScope(null);
      if (openRef.current && hit.session_id === openRef.current.header.id) {
        editorRef.current?.focusEntry(hit.entry_id);
        return;
      }
      if (!expanded[hit.session_id] || expanded[hit.session_id] === "loading") {
        try {
          const session = await backend.readSession(profileRef.current, hit.session_id);
          setExpanded((prev) => ({ ...prev, [hit.session_id]: session }));
        } catch (e) {
          showToast(errorMessage(e));
          return;
        }
      }
      setFocusTarget({ sessionId: hit.session_id, entryId: hit.entry_id, nonce: Date.now() });
    },
    [expanded, showToast],
  );

  const openSearch = useCallback((scope: SearchScope) => {
    setSearchScope(scope === "session" && !openRef.current ? "all" : scope);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchScope(null);
    editorRef.current?.focus();
  }, []);

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
  const spellOpts: SpellOptions = { enabled: settings.spellcheck && spellStatus === "ready", level: settings.autocorrect, rules };
  const spellLabel =
    !settings.spellcheck || spellStatus === "off"
      ? "spelling off"
      : spellStatus === "ready"
        ? `spelling ${spell.languages.join("·").toUpperCase()}${settings.autocorrect === "off" ? "" : ` · autocorrect ${settings.autocorrect}`}`
        : spellStatus === "error"
          ? `spelling unavailable (${spell.error ?? "error"})`
          : "loading dictionaries…";
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
        win={win}
        onSwitch={(p) => void switchProfile(p)}
        onEnd={() => void endSession()}
        onReopen={() => void reopen()}
        onPin={(pinned) => void setPinned(pinned)}
        onOpacity={(percent) => void setOpacity(percent)}
        onSearch={() => openSearch("all")}
      />
      {searchScope && (
        <SearchPanel
          scope={searchScope}
          sessionId={open?.header.id ?? null}
          search={runSearch}
          onScope={setSearchScope}
          onOpen={(hit) => void openHit(hit)}
          onClose={closeSearch}
        />
      )}
      <main className="stream">
        <SessionList sessions={closed} expanded={expanded} onToggle={(id) => void toggleSession(id)} onCopyMarkdown={(id) => void copyMarkdown(id)} focus={focusTarget} />
        <section className="live" aria-label="Current session">
          <div className="live-title">{liveTitle}</div>
          <Editor
            ref={editorRef}
            entries={open?.entries ?? []}
            docKey={docKey}
            handlers={{ onChange, onEndSession: endSession, onReopen: reopen, onHide: hideWindow, onOpacityStep: stepOpacity, onAddWord: addWord, onSearch: openSearch }}
            spell={spell}
            spellOptions={spellOpts}
          />
        </section>
      </main>
      <footer className="statusbar">
        <span className="status">
          {open ? `${open.entries.length} ${open.entries.length === 1 ? "entry" : "entries"}` : "nothing written yet"}
          {` · `}
          <span className="spell-status" data-status={spellStatus} title={userWords.length ? `${userWords.length} personal words` : undefined}>
            {spellLabel}
          </span>
          {info ? ` · ${info.portable ? "portable" : "data"}: ${info.data_root}` : ""}
        </span>
        <span className="hints">
          Enter new line · Shift+Enter new entry · Ctrl+Enter end session · Ctrl+Shift+Enter reopen · Ctrl+Shift+F search
          {win?.hotkey ? ` · ${win.hotkey} show/hide` : ""}
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
