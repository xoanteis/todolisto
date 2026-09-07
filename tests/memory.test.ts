import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryBackend } from "../src/backend/memory";
import type { Backend } from "../src/backend/types";

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const T = (hhmm: string, day = "07") => `2026-09-${day}T${hhmm}:00.000+02:00`;

describe("memory backend", () => {
  let storage: FakeStorage;
  let backend: Backend;

  beforeEach(() => {
    storage = new FakeStorage();
    backend = createMemoryBackend(storage);
  });

  it("creates sessions lazily, saves entries and survives a reload", async () => {
    const session = await backend.startSession("work", T("09:31"));
    const again = await backend.startSession("work", T("09:35"));
    expect(again.header.id).toBe(session.header.id);

    const saved = await backend.saveEntries("work", session.header.id, [
      { id: "e1", ts: T("09:31"), text: "#todo call Maria\n", tags: [] },
      { id: "e2", ts: T("09:32"), text: "   ", tags: [] },
    ]);
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0].tags).toEqual(["todo"]);
    expect(saved.entries[0].text).toBe("#todo call Maria");

    const reloaded = createMemoryBackend(storage);
    const stream = await reloaded.getStream("work", T("10:00"));
    expect(stream.open?.header.id).toBe(session.header.id);
    expect(stream.sessions[0]).toMatchObject({ open: true, entries: 1, todos: 1, first_line: "#todo call Maria" });
  });

  it("ends, refuses writes to closed sessions, and reopens", async () => {
    const session = await backend.startSession("work", T("09:00"));
    await backend.saveEntries("work", session.header.id, [{ id: "a", ts: T("09:00"), text: "x", tags: [] }]);
    const closed = await backend.endSession("work", session.header.id, T("09:30"), "manual");
    expect(closed?.end).toMatchObject({ entries: 1, reason: "manual", ended: T("09:30") });
    await expect(backend.saveEntries("work", session.header.id, [])).rejects.toThrow(/closed/);

    const reopened = await backend.reopenSession("work", session.header.id);
    expect(reopened.end).toBeNull();
    expect((await backend.getStream("work", T("09:40"))).open?.header.id).toBe(session.header.id);
  });

  it("discards empty sessions on end and applies the inactivity rule", async () => {
    const empty = await backend.startSession("personal", T("09:00"));
    expect(await backend.endSession("personal", empty.header.id, T("09:10"), "manual")).toBeNull();
    expect((await backend.getStream("personal", T("09:20"))).sessions).toHaveLength(0);

    const session = await backend.startSession("personal", T("10:00"));
    await backend.saveEntries("personal", session.header.id, [{ id: "a", ts: T("10:00"), text: "x", tags: [], edited: T("10:20") }]);
    expect(await backend.checkInactivity("personal", T("11:49"))).toBeNull();
    const closed = await backend.checkInactivity("personal", T("11:50"));
    expect(closed?.end).toMatchObject({ reason: "inactivity", ended: T("10:20") });
  });

  it("refuses to reopen while another session with entries is open", async () => {
    const first = await backend.startSession("work", T("09:00"));
    await backend.saveEntries("work", first.header.id, [{ id: "a", ts: T("09:00"), text: "one", tags: [] }]);
    await backend.endSession("work", first.header.id, T("09:30"), "manual");
    const second = await backend.startSession("work", T("10:00"));
    await backend.saveEntries("work", second.header.id, [{ id: "b", ts: T("10:00"), text: "two", tags: [] }]);
    await expect(backend.reopenSession("work", first.header.id)).rejects.toThrow(/another session/);
  });
});
