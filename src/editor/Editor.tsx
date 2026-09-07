import { useEffect, useRef } from "react";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import type { Entry } from "../backend/types";
import { goToLive, insertTab, splitEntry } from "./commands";
import { dayPlugin, stampPlugin } from "./plugins";
import { docToEntries, entriesToDoc } from "./serialize";

export interface EditorHandlers {
  onChange(entries: Entry[]): void;
  onEndSession(): void;
  onReopen(): void;
  /** Escape: hide the window. Return false to let the key through. */
  onHide(): boolean;
  onOpacityStep(delta: number): void;
}

interface Props {
  /** Entries to load when `docKey` changes. */
  entries: Entry[];
  /** Any change of this value rebuilds the document from `entries`. */
  docKey: string;
  handlers: EditorHandlers;
}

export function Editor({ entries, docKey, handlers }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: entriesToDoc(entriesRef.current),
      plugins: [
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
      ],
    });

    const view = new EditorView(host, {
      state,
      attributes: { spellcheck: "true", "aria-label": "Notes", role: "textbox", "aria-multiline": "true" },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) handlersRef.current.onChange(docToEntries(next.doc));
      },
    });
    viewRef.current = view;

    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    view.focus();
    const scroller = host.closest(".stream");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [docKey]);

  // Clicking the empty space under the text puts the caret at the end.
  const focusEnd = (e: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view || e.target !== e.currentTarget) return;
    e.preventDefault();
    goToLive(view.state, view.dispatch);
    view.focus();
  };

  return <div className="editor-wrap" onMouseDown={focusEnd} ref={hostRef} />;
}
