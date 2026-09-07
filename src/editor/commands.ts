import type { Command } from "prosemirror-state";
import { Selection } from "prosemirror-state";

import { ulid } from "../model/ulid";
import { schema } from "./schema";

/** Shift+Enter: split the current entry here; the new entry gets its
 *  timestamp when its first character is typed. */
export const splitEntry: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.depth < 2 || $from.node(1).type !== schema.nodes.entry) return false;
  if (dispatch) {
    let tr = state.tr;
    if (!state.selection.empty) tr = tr.deleteSelection();
    const pos = tr.selection.from;
    tr = tr.split(pos, 2, [
      { type: schema.nodes.entry, attrs: { id: ulid(), ts: null, edited: null } },
      { type: schema.nodes.paragraph },
    ]);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Ctrl+End: put the caret at the end of the live entry. */
export const goToLive: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView());
  return true;
};

/** Tab inserts two spaces instead of moving focus out of the editor. */
export const insertTab: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.insertText("  "));
  return true;
};
