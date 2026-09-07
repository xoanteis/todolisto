import { describe, expect, it } from "vitest";

import type { Session } from "../src/backend/types";
import { extractTags } from "../src/model/tags";
import { fold, renderMarkdown, searchSessions } from "../src/model/search";

function session(id: string, day: string, entries: [string, string, string][], open: boolean): Session {
  const s: Session = {
    header: { id, profile: "work", started: `${day}T09:00:00.000+02:00`, tz: "Europe/Madrid", title: `Session ${id}`, app: "", device: null },
    entries: entries.map(([eid, time, text]) => ({ id: eid, ts: `${day}T${time}.000+02:00`, text, tags: extractTags(text), edited: null })),
    end: open ? null : { ended: `${day}T12:00:00.000+02:00`, entries: entries.length, title: null, reason: "manual" },
    actions: [],
  };
  return s;
}

const corpus = [
  session("A", "2026-09-01", [["a1", "09:10:00", "Reunión con María sobre el presupuesto #todo"], ["a2", "09:20:00", "Idea: cache por tenant #idea"]], false),
  session("B", "2026-09-07", [["b1", "10:00:00", "Kickoff with ACME about the budget"], ["b2", "10:05:00", "María owes us the Q4 numbers #todo\nsecond line"], ["b3", "10:07:00", "budget review with maria next week"]], true),
];

describe("search (browser mirror of the Rust core)", () => {
  it("folds case and accents keeping one char per char", () => {
    expect(fold("Reunión María ÁÉÍÓÚ ñ")).toBe("reunion maria aeiou n");
  });

  it("matches every word, ignores accents, ranks phrases first and orders newest first", () => {
    const r = searchSessions(corpus, { text: "maria" });
    expect(r.total).toBe(3);
    expect(r.hits.map((h) => h.entry_id)).toEqual(["b3", "b2", "a1"]);
    expect(r.hits[2].highlights).toEqual([[12, 17]]);
    expect(Array.from(r.hits[2].text).slice(12, 17).join("")).toBe("María");
    expect(searchSessions(corpus, { text: "with maria" }).hits[0].entry_id).toBe("b3");
    expect(searchSessions(corpus, { text: "budget maria" }).hits.map((h) => h.entry_id)).toEqual(["b3"]);
  });

  it("filters by tag, day and session, and applies the limit", () => {
    expect(searchSessions(corpus, { text: "#todo" }).hits.map((h) => h.entry_id)).toEqual(["b2", "a1"]);
    expect(searchSessions(corpus, { text: "maria", tags: ["#TODO"] }).total).toBe(2);
    expect(searchSessions(corpus, { text: "#idea maria" }).total).toBe(0);
    expect(searchSessions(corpus, { from_day: "2026-09-07" }).total).toBe(3);
    expect(searchSessions(corpus, { to_day: "2026-09-01" }).total).toBe(2);
    expect(searchSessions(corpus, { session_id: "A" }).total).toBe(2);
    const limited = searchSessions(corpus, { limit: 2 });
    expect(limited.total).toBe(5);
    expect(limited.hits).toHaveLength(2);
  });

  it("renders Markdown like the core", () => {
    const md = renderMarkdown(corpus[0]);
    expect(md).toContain("# Session A\n");
    expect(md).toContain("## 2026-09-01\n");
    expect(md).toContain("- **09:10:00** Reunión con María sobre el presupuesto #todo\n");
  });
});
