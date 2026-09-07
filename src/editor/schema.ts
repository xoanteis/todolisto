// Document = entry+ ; entry = paragraph+ ; each entry carries its timestamp.
// Enter adds a paragraph inside the entry, Shift+Enter starts a new entry.

import { Schema } from "prosemirror-model";

import { timeOf } from "../model/time";

export const schema = new Schema({
  nodes: {
    doc: { content: "entry+" },
    entry: {
      content: "paragraph+",
      attrs: {
        id: { default: null },
        ts: { default: null },
        edited: { default: null },
      },
      toDOM(node) {
        const ts = node.attrs.ts as string | null;
        const attrs: Record<string, string> = {
          class: "entry",
          "data-id": (node.attrs.id as string | null) ?? "",
          "data-ts": ts ?? "",
          "data-time": ts ? timeOf(ts) : "",
        };
        if (node.attrs.edited) attrs["data-edited"] = "1";
        if (ts) attrs.title = ts;
        return ["div", attrs, 0];
      },
      parseDOM: [
        {
          tag: "div.entry",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              id: el.getAttribute("data-id") || null,
              ts: el.getAttribute("data-ts") || null,
              edited: null,
            };
          },
        },
      ],
    },
    paragraph: {
      content: "text*",
      toDOM() {
        return ["p", 0];
      },
      parseDOM: [{ tag: "p" }],
    },
    text: { inline: true },
  },
});

export type EditorSchema = typeof schema;
