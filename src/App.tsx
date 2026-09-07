import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createBackend } from "./backend";
import {
  MAX_OPACITY,
  MIN_OPACITY,
  OPACITY_STEP,
  errorMessage,
  type AgentStatus,
  type AppInfo,
  type DriveStatus,
  type Entry,
  type Pending,
  type Session,
  type SessionSummary,
  type Settings,
  type WindowState,
} from "./backend/types";
import { Header } from "./components/Header";
import { SearchPanel, type SearchScope } from "./components/SearchPanel";
import { SessionList, type Expanded } from "./components/SessionList";
import { SyncDialog } from "./components/SyncDialog";
import { AgentDialog } from "./components/AgentDialog";
import { DigestPanel } from "./components/DigestPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import type { Digest, DigestItem, Proposal, Selection } from "./model/agent";
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
  const [tags, setTags] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Expanded>({});
  const [focusTarget, setFocusTarget] = useState<{ sessionId: string; entryId: string; nonce: number } | null>(null);
  const [searchScope, setSearchScope] = useState<SearchScope | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const [driveStatuses, setDriveStatuses] = useState<Record<string, DriveStatus>>({});
  const [syncDialog, setSyncDialog] = useState(false);
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [agentDialog, setAgentDialog] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [review, setReview] = useState<{ sessionId: string; proposal: Proposal } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
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

  const refreshSessionsRef = useRef<() => Promise<void>>(async () => {});
  const refreshSessions = useCallback(() => refreshSessionsRef.current(), []);

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
      void Promise.all([backend.agentPending(p), backend.agentDigest(p), backend.listTags(p)])
        .then(([pendingList, digestData, tagList]) => {
          if (profileRef.current !== p) return;
          setPending(pendingList);
          setDigest(digestData);
          setTags(tagList.map((t) => t.tag));
        })
        .catch((e) => console.warn("agent state", e));
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

  useEffect(() => {
    backend.agentStatus().then(setAgentStatus).catch((e) => console.warn("agent status", e));
  }, []);

  const refreshAgent = useCallback(async () => {
    const p = profileRef.current;
    const [pendingList, digestData] = await Promise.all([backend.agentPending(p), backend.agentDigest(p)]);
    if (profileRef.current !== p) return;
    setPending(pendingList);
    setDigest(digestData);
  }, []);

  useEffect(() => {
    const unsubscribeProposal = backend.onAgentProposal((event) => {
      if (event.profile !== profileRef.current) return;
      void refreshAgent().then(() => showToast(event.todos ? `Session reviewed: ${event.todos} to-do${event.todos === 1 ? "" : "s"} proposed` : "Session reviewed"));
    });
    const unsubscribeError = backend.onAgentError((event) => {
      if (event.profile === profileRef.current) showToast(`Agent: ${event.error}`);
    });
    return () => {
      unsubscribeProposal();
      unsubscribeError();
    };
  }, [refreshAgent, showToast]);

  const openReview = useCallback(
    (sessionId: string) => {
      const item = pending.find((p) => p.session_id === sessionId);
      if (item) setReview({ sessionId, proposal: item.proposal });
    },
    [pending],
  );

  const runAgent = useCallback(
    async (sessionId: string) => {
      setReviewBusy(true);
      try {
        const proposal = await backend.agentRun(profileRef.current, sessionId);
        await refreshAgent();
        setReview({ sessionId, proposal });
      } catch (e) {
        showToast(`Agent: ${errorMessage(e)}`);
      } finally {
        setReviewBusy(false);
      }
    },
    [refreshAgent, showToast],
  );

  const applyReview = useCallback(
    async (selection: Selection) => {
      if (!review) return;
      setReviewBusy(true);
      try {
        const digestData = await backend.agentApply(profileRef.current, review.sessionId, review.proposal, selection);
        setDigest(digestData);
        setReview(null);
        await refreshAgent();
        await refreshSessions();
        const kept = selection.todos.length;
        showToast(kept ? `Applied · ${kept} to-do${kept === 1 ? "" : "s"} added (Ctrl+T)` : "Applied");
      } catch (e) {
        showToast(errorMessage(e));
      } finally {
        setReviewBusy(false);
      }
    },
    [review, refreshAgent, refreshSessions, showToast],
  );

  const discardReview = useCallback(async () => {
    if (!review) return;
    try {
      await backend.agentDiscard(profileRef.current, review.sessionId);
      setReview(null);
      await refreshAgent();
    } catch (e) {
      showToast(errorMessage(e));
    }
  }, [review, refreshAgent, showToast]);

  const toggleDone = useCallback(
    async (id: string, done: boolean) => {
      try {
        setDigest(await backend.todoSetDone(profileRef.current, id, done));
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [showToast],
  );

  const saveAgentKey = useCallback(
    async (key: string) => {
      try {
        setAgentStatus(await backend.agentSetKey(key));
        showToast(key ? "API key saved" : "API key removed");
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [showToast],
  );

  const saveAgentSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (!settings) return;
      try {
        const saved = await backend.saveSettings({ ...settings, ...patch });
        setSettings(saved);
        setAgentStatus(await backend.agentStatus());
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [settings, showToast],
  );

  const loadDriveStatuses = useCallback(async (profiles: string[]) => {
    const entries = await Promise.all(profiles.map(async (id) => [id, await backend.driveStatus(id)] as const));
    setDriveStatuses((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, []);

  useEffect(() => {
    if (!settings) return;
    loadDriveStatuses(settings.profiles.map((p) => p.id)).catch((e) => console.warn("drive status", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.profiles.map((p) => p.id).join(","), loadDriveStatuses]);

  /** Re-reads the history after files changed on disk, leaving the editor alone. */
  const refreshSessionsImpl = useCallback(async () => {
    const p = profileRef.current;
    const stream = await backend.getStream(p, nowIso());
    if (profileRef.current !== p) return;
    setSessions(stream.sessions);
    if (!openRef.current && stream.open) {
      setOpenSession(stream.open);
      setDocKey(`${p}:${stream.open.header.id}:${Date.now()}`);
    }
    setExpanded((prev) => {
      const ids = Object.keys(prev);
      void Promise.all(ids.map((id) => backend.readSession(p, id).catch(() => null))).then((loaded) => {
        setExpanded((current) => {
          const next = { ...current };
          ids.forEach((id, i) => {
            if (loaded[i] && next[id]) next[id] = loaded[i];
          });
          return next;
        });
      });
      return prev;
    });
  }, [setOpenSession]);

  refreshSessionsRef.current = refreshSessionsImpl;

  useEffect(() => {
    const unsubscribeStatus = backend.onSyncStatus((p, status) => setDriveStatuses((prev) => ({ ...prev, [p]: status })));
    const unsubscribeData = backend.onDataChanged((event) => {
      if (event.profile !== profileRef.current) return;
      void refreshSessionsImpl().catch((e) => console.warn("refresh after sync", e));
      if (event.dictionary) {
        Promise.all([backend.getUserWords(event.profile), backend.getAutocorrectRules(event.profile)])
          .then(([words, personal]) => {
            setUserWords(words);
            spell.setUserWords(words);
            setRules({ ...BUILTIN_RULES, ...personal });
          })
          .catch((e) => console.warn("reload dictionary", e));
      }
    });
    return () => {
      unsubscribeStatus();
      unsubscribeData();
    };
  }, [refreshSessionsImpl, spell]);

  const saveClient = useCallback(
    async (clientId: string, clientSecret: string) => {
      if (!settings) return;
      try {
        const saved = await backend.saveSettings({ ...settings, google_client_id: clientId, google_client_secret: clientSecret });
        setSettings(saved);
        await loadDriveStatuses(saved.profiles.map((p) => p.id));
        showToast("Google client saved");
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [settings, loadDriveStatuses, showToast],
  );

  const toggleDrive = useCallback(
    async (p: string, enabled: boolean) => {
      if (!settings) return;
      try {
        const saved = await backend.saveSettings({ ...settings, profiles: settings.profiles.map((x) => (x.id === p ? { ...x, drive: enabled } : x)) });
        setSettings(saved);
        await loadDriveStatuses([p]);
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [settings, loadDriveStatuses, showToast],
  );

  const connectDrive = useCallback(
    async (p: string) => {
      setSyncBusy(p);
      try {
        const status = await backend.driveConnect(p);
        setDriveStatuses((prev) => ({ ...prev, [p]: status }));
        setSettings(await backend.getSettings());
        showToast(`${status.account ?? "Google account"} connected · first sync running`);
        backend.driveSyncNow(p).catch((e) => showToast(errorMessage(e)));
      } catch (e) {
        showToast(errorMessage(e));
      } finally {
        setSyncBusy(null);
      }
    },
    [showToast],
  );

  const disconnectDrive = useCallback(
    async (p: string) => {
      try {
        const status = await backend.driveDisconnect(p);
        setDriveStatuses((prev) => ({ ...prev, [p]: status }));
        setSettings(await backend.getSettings());
      } catch (e) {
        showToast(errorMessage(e));
      }
    },
    [showToast],
  );

  const syncNow = useCallback(
    async (p: string) => {
      setSyncBusy(p);
      try {
        const report = await backend.driveSyncNow(p);
        const parts = [
          report.pulled.length ? `${report.pulled.length} pulled` : null,
          report.pushed.length ? `${report.pushed.length} pushed` : null,
          report.conflicts.length ? `${report.conflicts.length} conflict copies` : null,
        ].filter(Boolean);
        showToast(parts.length ? `Sync done: ${parts.join(", ")}` : "Sync done: everything was up to date");
      } catch (e) {
        showToast(errorMessage(e));
      } finally {
        setSyncBusy(null);
      }
    },
    [showToast],
  );

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
  const syncDialogRef = useRef(false);
  syncDialogRef.current = syncDialog;
  const overlayRef = useRef(false);
  overlayRef.current = review !== null || digestOpen || agentDialog;

  const hideWindow = useCallback((): boolean => {
    if (searchOpenRef.current) {
      setSearchScope(null);
      return true;
    }
    if (syncDialogRef.current) {
      setSyncDialog(false);
      return true;
    }
    if (overlayRef.current) {
      setReview(null);
      setDigestOpen(false);
      setAgentDialog(false);
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
        if (hit.entry_id) editorRef.current?.focusEntry(hit.entry_id);
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

  const closed = sessions.filter((s) => !s.open || s.id !== open?.header.id);
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
        drive={driveStatuses[profile] ?? null}
        onSync={() => setSyncDialog(true)}
        openTodos={digest?.todos.filter((t) => !t.done).length ?? 0}
        pendingReviews={pending.length}
        onDigest={() => setDigestOpen(true)}
        onAgent={() => setAgentDialog(true)}
      />
      {pending.length > 0 && !review && (
        <div className="pending-banner" role="status">
          <span>
            {pending.length === 1 ? "A session is waiting for review" : `${pending.length} sessions are waiting for review`}
            {pending[0].proposal.todos.length ? ` · ${pending[0].proposal.todos.length} to-do${pending[0].proposal.todos.length === 1 ? "" : "s"} proposed` : ""}
          </span>
          <button type="button" onClick={() => openReview(pending[0].session_id)}>
            Review
          </button>
        </div>
      )}
      {review && (
        <ReviewPanel
          sessionLabel={(() => {
            const s = sessions.find((x) => x.id === review.sessionId);
            return s ? `${formatDay(s.started)} ${timeOf(s.started)}` : review.sessionId;
          })()}
          proposal={review.proposal}
          canRerun={Boolean(agentStatus?.has_key && agentStatus.enabled)}
          busy={reviewBusy}
          onApply={(selection) => void applyReview(selection)}
          onRerun={() => void runAgent(review.sessionId)}
          onDiscard={() => void discardReview()}
          onClose={() => setReview(null)}
        />
      )}
      {digestOpen && (
        <DigestPanel
          digest={digest}
          onToggleDone={(id, done) => void toggleDone(id, done)}
          onOpen={(item: DigestItem) => {
            setDigestOpen(false);
            void openHit({ session_id: item.session_id, session_title: item.session_title, session_open: false, entry_id: item.entry_id ?? "", ts: item.ts, text: item.text, tags: [], highlights: [] });
          }}
          onClose={() => setDigestOpen(false)}
        />
      )}
      {agentDialog && (
        <AgentDialog
          settings={settings}
          status={agentStatus}
          onSaveKey={(key) => void saveAgentKey(key)}
          onSaveSettings={(patch) => void saveAgentSettings(patch)}
          onClose={() => setAgentDialog(false)}
        />
      )}
      {syncDialog && (
        <SyncDialog
          settings={settings}
          statuses={driveStatuses}
          busy={syncBusy}
          onSaveClient={(id, secret) => void saveClient(id, secret)}
          onToggle={(p, enabled) => void toggleDrive(p, enabled)}
          onConnect={(p) => void connectDrive(p)}
          onDisconnect={(p) => void disconnectDrive(p)}
          onSyncNow={(p) => void syncNow(p)}
          onClose={() => setSyncDialog(false)}
        />
      )}
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
        <SessionList
          sessions={closed}
          expanded={expanded}
          onToggle={(id) => void toggleSession(id)}
          onCopyMarkdown={(id) => void copyMarkdown(id)}
          focus={focusTarget}
          pending={new Set(pending.map((p) => p.session_id))}
          onReview={openReview}
          onRunAgent={(id) => void runAgent(id)}
        />
        <section className="live" aria-label="Current session">
          <div className="live-title">{liveTitle}</div>
          <Editor
            ref={editorRef}
            entries={open?.entries ?? []}
            docKey={docKey}
            handlers={{ onChange, onEndSession: endSession, onReopen: reopen, onHide: hideWindow, onOpacityStep: stepOpacity, onAddWord: addWord, onSearch: openSearch, onDigest: () => setDigestOpen(true) }}
            spell={spell}
            spellOptions={spellOpts}
            tags={tags}
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
          Enter new line · Shift+Enter new entry · Ctrl+Enter end session · Ctrl+Shift+Enter reopen · Ctrl+Shift+F search · Ctrl+T to do
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
