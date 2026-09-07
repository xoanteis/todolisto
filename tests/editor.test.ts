import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import type { Entry } from "../src/backend/types";
import { splitEntry } from "../src/editor/commands";
import { stampPlugin } from "../src/editor/plugins";
import { docToEntries, entriesToDoc } from "../src/editor/serialize";

function makeState(entries: Entry[], clock: () => string) {
  return EditorState.create({ doc: entriesToDoc(entries), plugins: [stampPlugin(clock)] });
}

function type(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text));
}

function endOfDoc(state: EditorState): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
}

describe("editor document", () => {
  it("stamps an entry with the clock when its first character arrives", () => {
    let now = "2026-09-07T09:31:05.123+02:00";
    let state = endOfDoc(makeState([], () => now));
    expect(docToEntries(state.doc)).toEqual([]);

    state = type(state, "Kickoff");
    let entries = docToEntries(state.doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].ts).toBe(now);
    expect(entries[0].text).toBe("Kickoff");
    expect(entries[0].edited).toBeNull();

    // More typing in the live entry keeps the original stamp and is not an edit.
    now = "2026-09-07T09:32:00.000+02:00";
    state = type(state, " with ACME");
    entries = docToEntries(state.doc);
    expect(entries[0].ts).toBe("2026-09-07T09:31:05.123+02:00");
    expect(entries[0].edited).toBeNull();
  });

  it("Shift+Enter creates an unstamped entry that is stamped when typed into", () => {
    let now = "2026-09-07T09:31:05.123+02:00";
    let state = type(endOfDoc(makeState([], () => now)), "first");
    now = "2026-09-07T09:40:00.000+02:00";
    expect(splitEntry(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).attrs.ts).toBeNull();
    expect(docToEntries(state.doc)).toHaveLength(1);

    state = type(state, "second");
    const entries = docToEntries(state.doc);
    expect(entries).toHaveLength(2);
    expect(entries[1].ts).toBe(now);
    expect(entries[1].id).not.toBe(entries[0].id);
  });

  it("marks an older entry as edited and re-stamps the emptied trailing entry", () => {
    const existing: Entry[] = [
      { id: "A", ts: "2026-09-07T09:00:00.000+02:00", text: "old note", tags: [] },
      { id: "B", ts: "2026-09-07T09:05:00.000+02:00", text: "newer", tags: [] },
    ];
    let now = "2026-09-07T10:00:00.000+02:00";
    let state = makeState(existing, () => now);
    expect(state.doc.childCount).toBe(3);

    // Edit inside the first entry (position 2 = after "o" of "old").
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    state = type(state, "X");
    let entries = docToEntries(state.doc);
    expect(entries[0].text).toBe("oXld note");
    expect(entries[0].edited).toBe(now);
    expect(entries[0].ts).toBe("2026-09-07T09:00:00.000+02:00");
    expect(entries[1].edited).toBeNull();

    // Type in the trailing entry, then delete it all: the stamp is dropped.
    state = endOfDoc(state);
    now = "2026-09-07T10:05:00.000+02:00";
    state = type(state, "tmp");
    expect(docToEntries(state.doc)).toHaveLength(3);
    const last = state.doc.child(2);
    const from = state.doc.content.size - last.nodeSize + 2;
    state = state.apply(state.tr.delete(from, from + 3));
    expect(state.doc.child(2).attrs.ts).toBeNull();
    entries = docToEntries(state.doc);
    expect(entries).toHaveLength(2);
  });

  it("round-trips multi-line entries", () => {
    const entries: Entry[] = [
      { id: "A", ts: "2026-09-07T09:00:00.000+02:00", text: "line one\n\nline three", tags: [], edited: "2026-09-07T09:30:00.000+02:00" },
    ];
    const state = makeState(entries, () => "2026-09-07T10:00:00.000+02:00");
    expect(docToEntries(state.doc)).toEqual([{ ...entries[0], tags: [] }]);
    expect(state.doc.child(0).childCount).toBe(3);
  });
});
