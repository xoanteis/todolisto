import { useEffect, useState } from "react";

import { CATEGORIES, CATEGORY_LABELS, type Category, type Digest, type DigestItem } from "../model/agent";
import { formatDay } from "../model/time";

interface Props {
  digest: Digest | null;
  onToggleDone(id: string, done: boolean): void;
  onOpen(item: DigestItem): void;
  onClose(): void;
}

export function DigestPanel({ digest, onToggleDone, onOpen, onClose }: Props) {
  const [tab, setTab] = useState<Category>("todos");
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const items = (digest?.[tab] ?? []).filter((i) => tab !== "todos" || showDone || !i.done);
  const openTodos = digest?.todos.filter((t) => !t.done).length ?? 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal digest" role="dialog" aria-label="To do and facts">
        <div className="modal-head">
          <h2>Actionable notes</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="tabs" role="tablist">
          {CATEGORIES.map((c) => (
            <button type="button" role="tab" key={c} className={tab === c ? "tab active" : "tab"} aria-selected={tab === c} onClick={() => setTab(c)}>
              {CATEGORY_LABELS[c]}
              <span className="muted small"> {c === "todos" ? openTodos : (digest?.[c].length ?? 0)}</span>
            </button>
          ))}
          <span className="spacer" />
          {tab === "todos" && (
            <label className="toggle small">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              show done
            </label>
          )}
        </div>
        <div className="digest-list">
          {items.length === 0 && <p className="muted">Nothing here yet. Items appear after you review a session.</p>}
          {items.map((item) => (
            <div className={item.done ? "digest-item done" : "digest-item"} key={item.id}>
              {tab === "todos" && <input type="checkbox" checked={item.done} onChange={(e) => onToggleDone(item.id, e.target.checked)} aria-label="Done" />}
              <button type="button" className="digest-text" onClick={() => onOpen(item)} title="Open the note">
                <span>{item.text}</span>
                <span className="hit-meta">
                  {formatDay(item.ts)}
                  {item.session_title ? ` · ${item.session_title}` : ""}
                  {item.due ? ` · due ${item.due}` : ""}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
