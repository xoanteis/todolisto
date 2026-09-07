import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { dayKey, formatDay, nowIso } from "../model/time";
import { ulid } from "../model/ulid";
import { entryText } from "./serialize";

export const stampKey = new PluginKey("stamp");

/**
 * Keeps entry attributes truthful after every change:
 * - an entry gets its timestamp when it receives its first character;
 * - the trailing entry drops its timestamp again when emptied, so it is
 *   re-stamped when typing resumes;
 * - a change to any entry other than the last one marks it as edited.
 */
export function stampPlugin(clock: () => string = nowIso): Plugin {
  return new Plugin({
    key: stampKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const oldText = new Map<string, string>();
      oldState.doc.forEach((node) => {
        if (node.attrs.id) oldText.set(node.attrs.id as string, entryText(node));
      });

      const count = newState.doc.childCount;
      const now = clock();
      let tr: Transaction | null = null;

      newState.doc.forEach((node, offset, index) => {
        const text = entryText(node);
        const empty = text.length === 0;
        const isLast = index === count - 1;
        let attrs = node.attrs;
        let changed = false;

        if (!attrs.id) {
          attrs = { ...attrs, id: ulid() };
          changed = true;
        }
        if (!attrs.ts && !empty) {
          attrs = { ...attrs, ts: now };
          changed = true;
        } else if (attrs.ts && empty && isLast) {
          attrs = { ...attrs, ts: null, edited: null };
          changed = true;
        } else if (attrs.ts && !isLast) {
          const before = oldText.get(attrs.id as string);
          if (before !== undefined && before !== text) {
            attrs = { ...attrs, edited: now };
            changed = true;
          }
        }

        if (changed) {
          tr = (tr ?? newState.tr).setNodeMarkup(offset, undefined, attrs);
        }
      });

      return tr;
    },
  });
}

function buildDayDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  let previous: string | null = null;
  doc.forEach((node, offset) => {
    const ts = node.attrs.ts as string | null;
    if (!ts) return;
    const day = dayKey(ts);
    if (day === previous) return;
    previous = day;
    decorations.push(
      Decoration.widget(
        offset,
        () => {
          const el = document.createElement("div");
          el.className = "day-sep";
          el.setAttribute("contenteditable", "false");
          el.textContent = formatDay(ts);
          return el;
        },
        { side: -1, key: `day-${day}-${offset}` },
      ),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/** A date heading before the first entry of each day. */
export function dayPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    state: {
      init: (_config, state) => buildDayDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? buildDayDecorations(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state) ?? null;
      },
    },
  });
}
