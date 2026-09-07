// `#tag` completion: while the caret is in a `#word` token, a menu offers the
// standard tags and the ones already used in the profile. Tab or Enter
// completes; Escape dismisses until the token changes.

import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export const STANDARD_TAGS = ["todo", "data", "q", "idea", "decision"];

export interface TagMenu {
  from: number;
  to: number;
  query: string;
  options: string[];
  index: number;
  left: number;
  top: number;
}

interface TagState {
  menu: TagMenu | null;
  /** Token start the user dismissed with Escape; reopened once it changes. */
  dismissed: number | null;
}

export const tagKey = new PluginKey<TagState>("tags");

export interface TagPluginOptions {
  /** Known tags, most used first. */
  tags(): string[];
  onMenu(menu: TagMenu | null): void;
}

const MAX_OPTIONS = 6;

/** Tags matching `query` as a prefix: known ones first, then standard ones. */
export function tagCandidates(query: string, known: string[]): string[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...known, ...STANDARD_TAGS]) {
    const lower = tag.toLowerCase();
    if (seen.has(lower) || !lower.startsWith(q)) continue;
    seen.add(lower);
    out.push(tag);
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
}

/** The `#token` the caret sits in, if any. */
function tokenAtCaret(state: EditorState): { from: number; to: number; query: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $head = selection.$head;
  if (!$head.parent.isTextblock) return null;
  const before = $head.parent.textBetween(0, $head.parentOffset, undefined, "￼");
  const match = /(^|[\s(])#([\p{L}\p{N}_:-]*)$/u.exec(before);
  if (!match) return null;
  const query = match[2];
  return { from: $head.pos - query.length - 1, to: $head.pos, query };
}

export function tagPlugin(options: TagPluginOptions): Plugin<TagState> {
  function accept(view: EditorView, menu: TagMenu, tag: string) {
    const tr = view.state.tr.insertText(`#${tag} `, menu.from, menu.to);
    tr.setMeta(tagKey, { close: true });
    view.dispatch(tr);
  }

  return new Plugin<TagState>({
    key: tagKey,
    state: {
      init: () => ({ menu: null, dismissed: null }),
      apply(tr: Transaction, prev: TagState, _old: EditorState, state: EditorState): TagState {
        const meta = tr.getMeta(tagKey) as { index?: number; close?: boolean; dismiss?: boolean } | undefined;
        if (meta?.dismiss) return { menu: null, dismissed: prev.menu?.from ?? null };
        if (meta?.close) return { menu: null, dismissed: null };
        if (meta?.index !== undefined && prev.menu) return { ...prev, menu: { ...prev.menu, index: meta.index } };
        if (!tr.docChanged && !tr.selectionSet) return prev;
        const token = tokenAtCaret(state);
        if (!token) return { menu: null, dismissed: null };
        if (prev.dismissed === token.from) return prev;
        const options = tagCandidates(token.query, options_tags());
        if (options.length === 0 || (options.length === 1 && options[0].toLowerCase() === token.query.toLowerCase())) {
          return { menu: null, dismissed: null };
        }
        const same = prev.menu && prev.menu.from === token.from && prev.menu.query === token.query;
        return {
          menu: { from: token.from, to: token.to, query: token.query, options, index: same ? Math.min(prev.menu!.index, options.length - 1) : 0, left: prev.menu?.left ?? 0, top: prev.menu?.top ?? 0 },
          dismissed: null,
        };
      },
    },
    props: {
      handleKeyDown(view, event) {
        const menu = tagKey.getState(view.state)?.menu;
        if (!menu) return false;
        switch (event.key) {
          case "ArrowDown":
          case "ArrowUp": {
            const step = event.key === "ArrowDown" ? 1 : menu.options.length - 1;
            view.dispatch(view.state.tr.setMeta(tagKey, { index: (menu.index + step) % menu.options.length }));
            return true;
          }
          case "Tab":
          case "Enter":
            accept(view, menu, menu.options[menu.index]);
            return true;
          case "Escape":
            view.dispatch(view.state.tr.setMeta(tagKey, { dismiss: true }));
            return true;
          default:
            return false;
        }
      },
    },
    view() {
      let last: TagMenu | null = null;
      return {
        update(view) {
          const menu = tagKey.getState(view.state)?.menu ?? null;
          if (menu === last) return;
          last = menu;
          if (!menu) {
            options.onMenu(null);
            return;
          }
          const coords = view.coordsAtPos(menu.from);
          options.onMenu({ ...menu, left: coords.left, top: coords.bottom });
        },
        destroy() {
          options.onMenu(null);
        },
      };
    },
  });

  function options_tags(): string[] {
    return options.tags();
  }
}

/** Called by the menu UI when an option is clicked. */
export function acceptTag(view: EditorView, menu: TagMenu, tag: string) {
  const tr = view.state.tr.insertText(`#${tag} `, menu.from, menu.to);
  tr.setMeta(tagKey, { close: true });
  view.dispatch(tr);
  view.focus();
}
