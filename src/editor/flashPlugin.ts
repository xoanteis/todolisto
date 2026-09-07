// Briefly highlights an entry (after a search jump). A node decoration is
// used rather than a DOM class because ProseMirror re-renders entries when
// other decorations change and would drop a class set by hand.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const flashKey = new PluginKey<DecorationSet>("flash");

export type FlashMeta = { from: number; to: number } | "clear";

export const FLASH_MS = 1600;

export function flashPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: flashKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(flashKey) as FlashMeta | undefined;
        if (meta === "clear") return DecorationSet.empty;
        if (meta) return DecorationSet.create(tr.doc, [Decoration.node(meta.from, meta.to, { class: "flash" })]);
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state) ?? null;
      },
    },
  });
}
