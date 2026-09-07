import type { Node as PMNode } from "prosemirror-model";

import type { Entry } from "../backend/types";
import { ulid } from "../model/ulid";
import { schema } from "./schema";

/** Text of an entry node: its paragraphs joined with `\n`. */
export function entryText(entry: PMNode): string {
  const lines: string[] = [];
  entry.forEach((paragraph) => lines.push(paragraph.textContent));
  return lines.join("\n");
}

/** Entries worth saving: stamped and not blank, in document order. */
export function docToEntries(doc: PMNode): Entry[] {
  const entries: Entry[] = [];
  doc.forEach((node) => {
    if (node.type.name !== "entry") return;
    const ts = node.attrs.ts as string | null;
    const text = entryText(node);
    if (!ts || text.trim() === "") return;
    entries.push({
      id: node.attrs.id as string,
      ts,
      text,
      tags: [],
      edited: (node.attrs.edited as string | null) ?? null,
    });
  });
  return entries;
}

export function makeEntry(id: string | null, ts: string | null, edited: string | null, lines: string[]): PMNode {
  const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined));
  return schema.nodes.entry.create({ id, ts, edited }, paragraphs);
}

/** A document for the given entries plus one empty, unstamped entry to type in. */
export function entriesToDoc(entries: Entry[]): PMNode {
  const nodes = entries.map((e) => makeEntry(e.id, e.ts, e.edited ?? null, e.text.split("\n")));
  nodes.push(makeEntry(ulid(), null, null, [""]));
  return schema.nodes.doc.create(null, nodes);
}
