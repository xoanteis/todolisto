import { Fragment, useState } from "react";

import type { Session, SessionSummary } from "../backend/types";
import { dayKey, formatDay, timeOf } from "../model/time";

interface Props {
  sessions: SessionSummary[];
  load(id: string): Promise<Session>;
}

const RECENT = 12;

export function SessionList({ sessions, load }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, Session | "loading">>({});

  if (sessions.length === 0) return null;
  const visible = showAll ? sessions : sessions.slice(-RECENT);
  const hidden = sessions.length - visible.length;

  async function toggle(id: string) {
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
      const session = await load(id);
      setExpanded((prev) => ({ ...prev, [id]: session }));
    } catch {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

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
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={s.id} className={state ? "session expanded" : "session"}>
            <button type="button" className="session-row" onClick={() => toggle(s.id)} aria-expanded={Boolean(state)}>
              <span className="chev" aria-hidden="true">
                {state ? "▾" : "▸"}
              </span>
              <span className="when">
                {formatDay(s.started)} · {timeOf(s.started)}
              </span>
              <span className="title">{s.title ?? s.first_line ?? ""}</span>
              <span className="meta">{meta}</span>
            </button>
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
            <div className="entry" data-time={timeOf(e.ts)} data-edited={e.edited ? "1" : undefined} title={e.ts}>
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
