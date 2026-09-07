// Misspelling underlines, the suggestion menu and autocorrect, on top of the
// spelling worker. The whole document is re-tokenised after each change
// (debounced); verdicts are cached per word, so only new words hit the worker.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { aggressiveCorrection, BOUNDARY, safeCorrection, type AutocorrectLevel } from "../spell/autocorrect";
import type { SpellClient } from "../spell/client";
import { tokenize, wordBefore } from "../spell/tokenize";

export interface SpellMenu {
  from: number;
  to: number;
  word: string;
  left: number;
  top: number;
  suggestions: string[] | null;
  index: number;
}

export interface SpellPluginOptions {
  client: SpellClient;
  enabled(): boolean;
  level(): AutocorrectLevel;
  rules(): Record<string, string>;
  onMenu(menu: SpellMenu | null): void;
}

interface Correction {
  from: number;
  to: number;
  original: string;
}

export interface SpellState {
  decorations: DecorationSet;
  ignored: Set<string>;
  lastCorrection: Correction | null;
  menu: SpellMenu | null;
}

interface Meta {
  decorations?: DecorationSet;
  ignore?: string;
  menu?: SpellMenu | null;
  correction?: Correction | null;
}

export const spellKey = new PluginKey<SpellState>("spell");

const CHECK_DELAY_MS = 250;

function textblocks(doc: PMNode): { text: string; start: number }[] {
  const blocks: { text: string; start: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      blocks.push({ text: node.textContent, start: pos + 1 });
      return false;
    }
    return true;
  });
  return blocks;
}

function withoutWord(decorations: DecorationSet, word: string): DecorationSet {
  return decorations.remove(decorations.find(undefined, undefined, (spec) => spec.word === word));
}

export function spellPlugin(options: SpellPluginOptions): Plugin<SpellState> {
  let timer: number | undefined;
  let running = false;
  let queued = false;

  function schedule(view: EditorView, delay = CHECK_DELAY_MS) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void runCheck(view), delay);
  }

  function setDecorations(view: EditorView, decorations: DecorationSet) {
    view.dispatch(view.state.tr.setMeta(spellKey, { decorations } satisfies Meta));
  }

  async function runCheck(view: EditorView) {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const { client } = options;
      const state = view.state;
      const current = spellKey.getState(state);
      if (!current) return;
      if (!options.enabled() || client.status !== "ready") {
        if (current.decorations !== DecorationSet.empty) setDecorations(view, DecorationSet.empty);
        return;
      }
      const head = state.selection.head;
      const spans: { from: number; to: number; word: string }[] = [];
      for (const block of textblocks(state.doc)) {
        for (const t of tokenize(block.text)) {
          const from = block.start + t.from;
          const to = block.start + t.to;
          if (head >= from && head <= to) continue; // the word being typed
          spans.push({ from, to, word: t.word });
        }
      }
      const unknown = [...new Set(spans.map((s) => s.word))].filter((w) => client.isKnown(w) === undefined);
      if (unknown.length) await client.check(unknown);
      if (view.isDestroyed) return;
      if (view.state.doc !== state.doc || view.state.selection.head !== head) {
        queued = true;
        return;
      }
      const decorations = spans
        .filter((s) => client.isKnown(s.word) === false && !current.ignored.has(s.word))
        .map((s) => Decoration.inline(s.from, s.to, { class: "misspelled" }, { word: s.word }));
      setDecorations(view, DecorationSet.create(state.doc, decorations));
    } catch (e) {
      console.warn("spell check failed", e);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule(view);
      }
    }
  }

  function decorationAt(state: EditorState, pos: number): Decoration | null {
    const found = spellKey.getState(state)?.decorations.find(Math.max(0, pos - 1), pos + 1) ?? [];
    return found.find((d) => d.from <= pos && pos <= d.to) ?? null;
  }

  function openMenu(view: EditorView, pos: number): boolean {
    const decoration = decorationAt(view.state, pos);
    if (!decoration) return false;
    const coords = view.coordsAtPos(decoration.from);
    const word = decoration.spec.word as string;
    const menu: SpellMenu = { from: decoration.from, to: decoration.to, word, left: coords.left, top: coords.bottom, suggestions: null, index: 0 };
    view.dispatch(view.state.tr.setMeta(spellKey, { menu } satisfies Meta));
    void options.client.suggest(word).then((suggestions) => {
      if (view.isDestroyed) return;
      const open = spellKey.getState(view.state)?.menu;
      if (!open || open.from !== menu.from || open.word !== word) return;
      view.dispatch(view.state.tr.setMeta(spellKey, { menu: { ...open, suggestions } } satisfies Meta));
    });
    return true;
  }

  function applyCorrection(view: EditorView, from: number, to: number, original: string, replacement: string, tail: string) {
    const tr = view.state.tr.insertText(replacement + tail, from, to);
    tr.setMeta(spellKey, { correction: { from, to: from + replacement.length, original } } satisfies Meta);
    view.dispatch(tr);
  }

  async function aggressive(view: EditorView, from: number, to: number, word: string) {
    const { client } = options;
    if (client.status !== "ready") return;
    const known = client.isKnown(word) ?? (await client.check([word])).get(word);
    if (known !== false) return;
    const fix = aggressiveCorrection(word, await client.suggest(word));
    if (!fix || view.isDestroyed) return;
    const doc = view.state.doc;
    if (to > doc.content.size || doc.textBetween(from, to) !== word) return;
    const tr = view.state.tr.insertText(fix, from, to);
    tr.setMeta(spellKey, { correction: { from, to: from + fix.length, original: word } } satisfies Meta);
    view.dispatch(tr);
  }

  return new Plugin<SpellState>({
    key: spellKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, ignored: new Set(), lastCorrection: null, menu: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(spellKey) as Meta | undefined;
        let next = prev;
        if (tr.docChanged) {
          next = { ...next, decorations: next.decorations.map(tr.mapping, tr.doc), menu: null, lastCorrection: meta?.correction ?? null };
        }
        if (meta?.decorations) next = { ...next, decorations: meta.decorations };
        if (meta?.ignore) {
          const ignored = new Set(next.ignored);
          ignored.add(meta.ignore);
          next = { ...next, ignored, decorations: withoutWord(next.decorations, meta.ignore) };
        }
        if (meta && "menu" in meta) next = { ...next, menu: meta.menu ?? null };
        if (meta && "correction" in meta && !tr.docChanged) next = { ...next, lastCorrection: meta.correction ?? null };
        return next;
      },
    },
    props: {
      decorations(state) {
        return spellKey.getState(state)?.decorations ?? null;
      },
      handleTextInput(view, from, _to, text) {
        if (!options.enabled() || options.level() === "off" || text.length !== 1 || !BOUNDARY.test(text)) return false;
        if (!view.state.selection.empty) return false;
        const $from = view.state.doc.resolve(from);
        if (!$from.parent.isTextblock) return false;
        const found = wordBefore($from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc"), $from.parentOffset);
        if (!found) return false;
        const wordFrom = from - found.word.length;
        const safe = safeCorrection(found.word, options.rules());
        if (safe) {
          applyCorrection(view, wordFrom, from, found.word, safe, text);
          return true;
        }
        if (options.level() === "aggressive") void aggressive(view, wordFrom, from, found.word);
        return false;
      },
      handleKeyDown(view, event) {
        const state = spellKey.getState(view.state);
        if (!state) return false;
        if (event.key === "Backspace" && state.lastCorrection && view.state.selection.empty) {
          const c = state.lastCorrection;
          if (view.state.selection.head === c.to + 1) {
            const tr = view.state.tr.insertText(c.original, c.from, c.to);
            tr.setMeta(spellKey, { correction: null } satisfies Meta);
            view.dispatch(tr);
            return true;
          }
        }
        if (state.menu) {
          const menu = state.menu;
          const count = menu.suggestions?.length ?? 0;
          if (event.key === "Escape") {
            view.dispatch(view.state.tr.setMeta(spellKey, { menu: null } satisfies Meta));
            return true;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (count === 0) return true;
            const index = (menu.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            view.dispatch(view.state.tr.setMeta(spellKey, { menu: { ...menu, index } } satisfies Meta));
            return true;
          }
          if (event.key === "Enter" && count > 0 && menu.suggestions) {
            const tr = view.state.tr.insertText(menu.suggestions[menu.index], menu.from, menu.to);
            tr.setMeta(spellKey, { menu: null } satisfies Meta);
            view.dispatch(tr);
            return true;
          }
        }
        if (event.key === "." && (event.ctrlKey || event.metaKey)) {
          return openMenu(view, view.state.selection.head);
        }
        return false;
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos || !openMenu(view, pos.pos)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
    view(view) {
      const unsubscribe = options.client.onStatus(() => schedule(view, 0));
      schedule(view, 0);
      return {
        update(view, prevState) {
          if (view.state.doc !== prevState.doc || view.state.selection.head !== prevState.selection.head) schedule(view);
          const menu = spellKey.getState(view.state)?.menu ?? null;
          const previous = spellKey.getState(prevState)?.menu ?? null;
          if (menu !== previous) options.onMenu(menu);
        },
        destroy() {
          window.clearTimeout(timer);
          unsubscribe();
        },
      };
    },
  });
}
