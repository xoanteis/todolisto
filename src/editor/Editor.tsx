import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import type { Entry } from "../backend/types";
import { SuggestionMenu } from "../components/SuggestionMenu";
import { TagMenu } from "../components/TagMenu";
import type { AutocorrectLevel } from "../spell/autocorrect";
import type { SpellClient } from "../spell/client";
import { goToLive, insertTab, splitEntry } from "./commands";
import { FLASH_MS, flashKey, flashPlugin } from "./flashPlugin";
import { dayPlugin, stampPlugin } from "./plugins";
import { docToEntries, entriesToDoc } from "./serialize";
import { spellKey, spellPlugin, type SpellMenu } from "./spellPlugin";
import { acceptTag, tagPlugin, type TagMenu as TagMenuState } from "./tagPlugin";

export interface EditorHandlers {
  onChange(entries: Entry[]): void;
  onEndSession(): void;
  onReopen(): void;
  /** Escape: hide the window. Return false to let the key through. */
  onHide(): boolean;
  onOpacityStep(delta: number): void;
  /** The user added a word to the dictionary of the active profile. */
  onAddWord(word: string): void;
  /** Ctrl+F (this session) and Ctrl+Shift+F (everything). */
  onSearch(scope: "session" | "all"): void;
  /** Ctrl+T: the to-do digest. */
  onDigest(): void;
}

export interface EditorHandle {
  /** Puts the caret at the start of an entry and scrolls it into view. */
  focusEntry(entryId: string): boolean;
  focus(): void;
}

export interface SpellOptions {
  enabled: boolean;
  level: AutocorrectLevel;
  rules: Record<string, string>;
}

interface Props {
  /** Entries to load when `docKey` changes. */
  entries: Entry[];
  /** Any change of this value rebuilds the document from `entries`. */
  docKey: string;
  handlers: EditorHandlers;
  spell: SpellClient;
  spellOptions: SpellOptions;
  /** Known tags of the profile, most used first. */
  tags: string[];
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ entries, docKey, handlers, spell, spellOptions, tags }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const spellOptionsRef = useRef(spellOptions);
  spellOptionsRef.current = spellOptions;
  const [menu, setMenu] = useState<SpellMenu | null>(null);
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null);
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  useImperativeHandle(ref, () => ({
    focusEntry(entryId) {
      const view = viewRef.current;
      if (!view) return false;
      let target: { from: number; to: number } | null = null;
      view.state.doc.forEach((node, offset) => {
        if (!target && node.attrs.id === entryId) target = { from: offset, to: offset + node.nodeSize };
      });
      if (!target) return false;
      const { from, to } = target;
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 2)).scrollIntoView();
      tr.setMeta(flashKey, { from, to });
      view.dispatch(tr);
      view.focus();
      window.setTimeout(() => {
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(flashKey, "clear"));
      }, FLASH_MS);
      return true;
    },
    focus() {
      viewRef.current?.focus();
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: entriesToDoc(entriesRef.current),
      plugins: [
        tagPlugin({ tags: () => tagsRef.current, onMenu: setTagMenu }),
        keymap({
          Enter: splitBlock,
          "Shift-Enter": splitEntry,
          "Mod-Enter": () => {
            handlersRef.current.onEndSession();
            return true;
          },
          "Mod-Shift-Enter": () => {
            handlersRef.current.onReopen();
            return true;
          },
          "Mod-End": goToLive,
          "Mod-f": () => {
            handlersRef.current.onSearch("session");
            return true;
          },
          "Mod-Shift-f": () => {
            handlersRef.current.onSearch("all");
            return true;
          },
          "Mod-t": () => {
            handlersRef.current.onDigest();
            return true;
          },
          Escape: () => handlersRef.current.onHide(),
          "Mod-Shift-ArrowUp": () => {
            handlersRef.current.onOpacityStep(+1);
            return true;
          },
          "Mod-Shift-ArrowDown": () => {
            handlersRef.current.onOpacityStep(-1);
            return true;
          },
          Tab: insertTab,
          "Shift-Tab": () => true,
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
        }),
        keymap(baseKeymap),
        history(),
        stampPlugin(),
        dayPlugin(),
        flashPlugin(),
        spellPlugin({
          client: spell,
          enabled: () => spellOptionsRef.current.enabled,
          level: () => spellOptionsRef.current.level,
          rules: () => spellOptionsRef.current.rules,
          onMenu: setMenu,
        }),
      ],
    });

    const view = new EditorView(host, {
      state,
      // The bundled dictionaries replace the WebView's own spell checker.
      attributes: { spellcheck: "false", "aria-label": "Notes", role: "textbox", "aria-multiline": "true" },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) handlersRef.current.onChange(docToEntries(next.doc));
      },
    });
    viewRef.current = view;
    if (import.meta.env.DEV) (window as unknown as { __pmView?: EditorView }).__pmView = view;

    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    view.focus();
    const scroller = host.closest(".stream");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;

    return () => {
      view.destroy();
      viewRef.current = null;
      setMenu(null);
    };
  }, [docKey, spell]);

  // Clicking the empty space under the text puts the caret at the end.
  const focusEnd = (e: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view || e.target !== e.currentTarget) return;
    e.preventDefault();
    goToLive(view.state, view.dispatch);
    view.focus();
  };

  const closeMenu = (extra: { ignore?: string } = {}) => {
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta(spellKey, { menu: null, ...extra }));
  };

  const pick = (replacement: string) => {
    const view = viewRef.current;
    if (!view || !menu) return;
    const tr = view.state.tr.insertText(replacement, menu.from, menu.to);
    tr.setMeta(spellKey, { menu: null });
    view.dispatch(tr);
    view.focus();
  };

  const addWord = () => {
    if (!menu) return;
    handlersRef.current.onAddWord(menu.word);
    closeMenu({ ignore: menu.word });
  };

  return (
    <div className="editor-wrap" onMouseDown={focusEnd} ref={hostRef}>
      {menu && <SuggestionMenu menu={menu} onPick={pick} onAdd={addWord} onIgnore={() => closeMenu({ ignore: menu.word })} />}
      {tagMenu && <TagMenu menu={tagMenu} onPick={(tag) => viewRef.current && acceptTag(viewRef.current, tagMenu, tag)} />}
    </div>
  );
});
