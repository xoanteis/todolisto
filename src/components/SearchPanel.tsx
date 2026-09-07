import { useEffect, useMemo, useRef, useState } from "react";

import type { SearchHit, SearchQuery, SearchResult } from "../model/search";
import { formatDay, timeOf } from "../model/time";

export type SearchScope = "all" | "session";

interface Props {
  scope: SearchScope;
  sessionId: string | null;
  search(query: SearchQuery): Promise<SearchResult>;
  onScope(scope: SearchScope): void;
  onOpen(hit: SearchHit): void;
  onClose(): void;
}

type Range = "any" | "today" | "week" | "month" | "quarter";

const RANGES: { id: Range; label: string; days: number | null }[] = [
  { id: "any", label: "Any time", days: null },
  { id: "today", label: "Today", days: 0 },
  { id: "week", label: "7 days", days: 7 },
  { id: "month", label: "30 days", days: 30 },
  { id: "quarter", label: "90 days", days: 90 },
];

function fromDay(range: Range): string | null {
  const days = RANGES.find((r) => r.id === range)?.days;
  if (days === null || days === undefined) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The text of a hit with `<mark>` around the matches, shortened around the first one. */
function Snippet({ hit }: { hit: SearchHit }) {
  const chars = Array.from(hit.text);
  const MAX = 220;
  let start = 0;
  if (chars.length > MAX && hit.highlights.length > 0) {
    start = Math.max(0, hit.highlights[0][0] - 60);
  }
  const end = Math.min(chars.length, start + MAX);
  const parts: React.ReactNode[] = [];
  let cursor = start;
  for (const [from, to] of hit.highlights) {
    if (to <= start || from >= end) continue;
    const f = Math.max(from, start);
    const t = Math.min(to, end);
    if (f > cursor) parts.push(chars.slice(cursor, f).join(""));
    parts.push(<mark key={`${f}-${t}`}>{chars.slice(f, t).join("")}</mark>);
    cursor = t;
  }
  if (cursor < end) parts.push(chars.slice(cursor, end).join(""));
  return (
    <span className="snippet">
      {start > 0 ? "…" : ""}
      {parts}
      {end < chars.length ? "…" : ""}
    </span>
  );
}

export function SearchPanel({ scope, sessionId, search, onScope, onOpen, onClose }: Props) {
  const [text, setText] = useState("");
  const [range, setRange] = useState<Range>("any");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const query = useMemo<SearchQuery>(
    () => ({ text, session_id: scope === "session" ? sessionId : null, from_day: fromDay(range), limit: 100 }),
    [text, scope, sessionId, range],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      search(query)
        .then((r) => {
          if (!cancelled) {
            setResult(r);
            setIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) setResult({ hits: [], total: 0 });
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, search]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".hit.active")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const hits = result?.hits ?? [];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setIndex((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setIndex((i) => (i + hits.length - 1) % hits.length);
    } else if (e.key === "Enter" && hits[index]) {
      e.preventDefault();
      onOpen(hits[index]);
    }
  };

  return (
    <div className="search-panel" role="dialog" aria-label="Search notes" onKeyDown={onKeyDown}>
      <div className="search-row">
        <input
          ref={inputRef}
          className="search-input"
          type="search"
          placeholder={scope === "session" ? "Find in this session… (#tag filters)" : "Search all notes… (#tag filters, accents optional)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search text"
        />
        <div className="scope" role="radiogroup" aria-label="Scope">
          <button type="button" className={scope === "session" ? "active" : ""} disabled={!sessionId} onClick={() => onScope("session")} aria-pressed={scope === "session"}>
            This session
          </button>
          <button type="button" className={scope === "all" ? "active" : ""} onClick={() => onScope("all")} aria-pressed={scope === "all"}>
            Everything
          </button>
        </div>
        <button type="button" className="close" onClick={onClose} title="Close (Esc)" aria-label="Close search">
          ×
        </button>
      </div>
      <div className="search-row filters">
        {RANGES.map((r) => (
          <button type="button" key={r.id} className={range === r.id ? "chip active" : "chip"} onClick={() => setRange(r.id)} aria-pressed={range === r.id}>
            {r.label}
          </button>
        ))}
        <span className="spacer" />
        <span className="count">
          {result ? `${result.total} ${result.total === 1 ? "result" : "results"}${result.total > hits.length ? ` (showing ${hits.length})` : ""}` : ""}
        </span>
      </div>
      <div className="hits" ref={listRef}>
        {hits.map((hit, i) => (
          <button
            type="button"
            key={hit.entry_id}
            className={i === index ? "hit active" : "hit"}
            onMouseEnter={() => setIndex(i)}
            onClick={() => onOpen(hit)}
          >
            <span className="hit-meta">
              {formatDay(hit.ts)} · {timeOf(hit.ts)}
              {hit.session_open ? " · open session" : hit.session_title ? ` · ${hit.session_title}` : ""}
              {hit.tags.length ? ` · ${hit.tags.map((t) => `#${t}`).join(" ")}` : ""}
            </span>
            <Snippet hit={hit} />
          </button>
        ))}
        {result && hits.length === 0 && <div className="no-hits">Nothing found.</div>}
      </div>
    </div>
  );
}
