// Mirror of the Rust search (crates/core/src/search.rs) for the in-browser
// backend. Same folding, same ranking, same highlight offsets.

import type { Session } from "../backend/types";

export interface SearchQuery {
  text?: string;
  tags?: string[];
  session_id?: string | null;
  from_day?: string | null;
  to_day?: string | null;
  limit?: number | null;
}

export interface SearchHit {
  session_id: string;
  session_title: string | null;
  session_open: boolean;
  entry_id: string;
  ts: string;
  text: string;
  tags: string[];
  highlights: [number, number][];
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

export const DEFAULT_LIMIT = 200;

/** Lower-case without diacritics, one output char per input char. */
export function fold(text: string): string {
  return Array.from(text)
    .map((c) => {
      const base = Array.from(c.normalize("NFD")).find((d) => !/\p{M}/u.test(d)) ?? c;
      return Array.from(base.toLowerCase())[0] ?? base;
    })
    .join("");
}

function findAll(haystack: string[], needle: string[]): [number, number][] {
  const hits: [number, number][] = [];
  if (needle.length === 0 || needle.length > haystack.length) return hits;
  let i = 0;
  while (i + needle.length <= haystack.length) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      hits.push([i, i + needle.length]);
      i += needle.length;
    } else {
      i += 1;
    }
  }
  return hits;
}

export function searchSessions(sessions: Session[], query: SearchQuery): SearchResult {
  const tags = (query.tags ?? []).map((t) => fold(t.replace(/^#/, ""))).filter(Boolean);
  const words: string[][] = [];
  const phraseWords: string[] = [];
  for (const raw of (query.text ?? "").split(/\s+/).filter(Boolean)) {
    if (raw.startsWith("#")) {
      const tag = fold(raw.slice(1));
      if (tag && !tags.includes(tag)) tags.push(tag);
      continue;
    }
    const folded = fold(raw);
    if (folded) {
      phraseWords.push(folded);
      words.push(Array.from(folded));
    }
  }
  const phrase = Array.from(phraseWords.join(" "));
  const limit = Math.max(1, query.limit ?? DEFAULT_LIMIT);
  const ranked: { rank: number; hit: SearchHit }[] = [];

  for (const session of sessions) {
    if (query.session_id && session.header.id !== query.session_id) continue;
    for (const entry of session.entries) {
      if (!tags.every((t) => entry.tags.some((et) => fold(et) === t))) continue;
      const day = entry.ts.slice(0, 10);
      if (query.from_day && day < query.from_day) continue;
      if (query.to_day && day > query.to_day) continue;
      const folded = Array.from(fold(entry.text));
      const highlights: [number, number][] = [];
      let all = true;
      for (const word of words) {
        const found = findAll(folded, word);
        if (found.length === 0) {
          all = false;
          break;
        }
        highlights.push(...found);
      }
      if (!all) continue;
      const rank = words.length > 1 && findAll(folded, phrase).length > 0 ? 0 : 1;
      highlights.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const unique = highlights.filter((h, i) => i === 0 || h[0] !== highlights[i - 1][0] || h[1] !== highlights[i - 1][1]);
      ranked.push({
        rank,
        hit: {
          session_id: session.header.id,
          session_title: session.end?.title ?? session.header.title ?? null,
          session_open: !session.end,
          entry_id: entry.id,
          ts: entry.ts,
          text: entry.text,
          tags: entry.tags,
          highlights: unique,
        },
      });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || Date.parse(b.hit.ts) - Date.parse(a.hit.ts));
  return { hits: ranked.slice(0, limit).map((r) => r.hit), total: ranked.length };
}

/** Markdown rendering of a session, same shape as the Rust renderer. */
export function renderMarkdown(session: Session): string {
  const started = session.header.started;
  const title = session.end?.title ?? session.header.title ?? `Session ${started.slice(0, 10)} ${started.slice(11, 16)}`;
  const lines = [`# ${title}`, ""];
  let meta = `Profile: ${session.header.profile} · Started: ${started.slice(0, 10)} ${started.slice(11, 19)} ${started.slice(23)}`;
  if (session.end) meta += ` · Ended: ${session.end.ended.slice(0, 10)} ${session.end.ended.slice(11, 19)}`;
  meta += ` · Entries: ${session.entries.length}`;
  if (session.header.device) meta += ` · Device: ${session.header.device}`;
  lines.push(meta, "");
  let day: string | null = null;
  for (const e of session.entries) {
    const d = e.ts.slice(0, 10);
    if (d !== day) {
      if (day !== null) lines.push("");
      lines.push(`## ${d}`, "");
      day = d;
    }
    const [first, ...rest] = e.text.split("\n");
    lines.push(`- **${e.ts.slice(11, 19)}** ${first}${rest.map((l) => `\n  ${l}`).join("")}${e.edited ? " _(edited)_" : ""}`);
  }
  return lines.join("\n") + "\n";
}
