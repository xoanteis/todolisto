import { Fragment, useEffect, useState } from "react";

import type { Session, SessionSummary } from "../backend/types";
import { dayKey, formatDay, timeOf } from "../model/time";

export type Expanded = Record<string, Session | "loading">;

interface Props {
  sessions: SessionSummary[];
  expanded: Expanded;
  onToggle(id: string): void;
  onCopyMarkdown(id: string): void;
  /** Entry to scroll to once its session is expanded; `nonce` retriggers. */
  focus: { sessionId: string; entryId: string; nonce: number } | null;
}

const RECENT = 12;

export function SessionList({ sessions, expanded, onToggle, onCopyMarkdown, focus }: Props) {
  const [showAll, setShowAll] = useState(false);

  const focusedSession = focus ? expanded[focus.sessionId] : undefined;
  useEffect(() => {
    if (!focus || !focusedSession || focusedSession === "loading") return;
    const el = document.querySelector<HTMLElement>(`[data-entry-id="${focus.entryId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    const timer = window.setTimeout(() => el.classList.remove("flash"), 1600);
    return () => window.clearTimeout(timer);
  }, [focus, focusedSession]);

  if (sessions.length === 0) return null;
  const forced = focus ? sessions.findIndex((s) => s.id === focus.sessionId) : -1;
  const visible = showAll || (forced >= 0 && forced < sessions.length - RECENT) ? sessions : sessions.slice(-RECENT);
  const hidden = sessions.length - visible.length;

  return (
    <section className="history" aria-label="Past sessions">
      {hidden > 0 && (
        <button type="button" className="link" onClick={() => setShowAll(true)}>
          Show {hidden} older {hidden === 1 ? "session" : "sessions"}
        </button>
      )}
      {visible.map((s) => {
        const state = expanded[s.id];
        const meta = [
          `${s.entries} ${s.entries === 1 ? "entry" : "entries"}`,
          s.todos ? `${s.todos} ${s.todos === 1 ? "todo" : "todos"}` : null,
          s.reason === "inactivity" ? "auto-closed" : null,
          s.open ? `open on ${s.device ?? "another PC"}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={s.id} className={state ? "session expanded" : "session"} data-session-id={s.id}>
            <div className="session-head">
              <button type="button" className="session-row" onClick={() => onToggle(s.id)} aria-expanded={Boolean(state)}>
                <span className="chev" aria-hidden="true">
                  {state ? "▾" : "▸"}
                </span>
                <span className="when">
                  {formatDay(s.started)} · {timeOf(s.started)}
                </span>
                <span className="title">{s.title ?? s.first_line ?? ""}</span>
                <span className="meta">{meta}</span>
              </button>
              {state && state !== "loading" && (
                <button type="button" className="copy" onClick={() => onCopyMarkdown(s.id)} title="Copy this session as Markdown">
                  Copy as Markdown
                </button>
              )}
            </div>
            {state === "loading" && <div className="session-body muted">Loading…</div>}
            {state && state !== "loading" && <SessionView session={state} />}
          </div>
        );
      })}
    </section>
  );
}

function SessionView({ session }: { session: Session }) {
  let previousDay: string | null = null;
  return (
    <div className="session-body">
      {session.entries.map((e) => {
        const day = dayKey(e.ts);
        const separator = day !== previousDay;
        previousDay = day;
        return (
          <Fragment key={e.id}>
            {separator && <div className="day-sep">{formatDay(e.ts)}</div>}
            <div className="entry" data-entry-id={e.id} data-time={timeOf(e.ts)} data-edited={e.edited ? "1" : undefined} title={e.ts}>
              {e.text.split("\n").map((line, i) => (
                <p key={i}>{line || "\u00a0"}</p>
              ))}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
