import { useEffect, useState } from "react";

import { CATEGORIES, CATEGORY_LABELS, selectAll, type Proposal, type Selection } from "../model/agent";

interface Props {
  sessionLabel: string;
  proposal: Proposal;
  canRerun: boolean;
  busy: boolean;
  onApply(selection: Selection): void;
  onRerun(): void;
  onDiscard(): void;
  onClose(): void;
}

export function ReviewPanel({ sessionLabel, proposal, canRerun, busy, onApply, onRerun, onDiscard, onClose }: Props) {
  const [selection, setSelection] = useState<Selection>(() => selectAll(proposal));

  useEffect(() => {
    setSelection(selectAll(proposal));
  }, [proposal]);

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

  const toggle = (category: keyof Selection, index: number) => {
    setSelection((prev) => {
      const list = prev[category] as number[];
      const next = list.includes(index) ? list.filter((i) => i !== index) : [...list, index].sort((a, b) => a - b);
      return { ...prev, [category]: next };
    });
  };

  const kept = CATEGORIES.reduce((n, c) => n + selection[c].length, 0);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal review" role="dialog" aria-label="Session review">
        <div className="modal-head">
          <h2>Review · {sessionLabel}</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted small">
          {proposal.source === "tags"
            ? "Built from your #tags (no API key set, so Claude did not read the notes)."
            : `Proposed by ${proposal.source.replace("claude:", "Claude ")} from your notes; nothing is saved until you apply.`}
        </p>

        <label className="field">
          <span>Title</span>
          <input value={selection.title ?? ""} onChange={(e) => setSelection((prev) => ({ ...prev, title: e.target.value }))} placeholder="Session title" />
        </label>

        {proposal.summary.trim() && (
          <label className="check summary">
            <input type="checkbox" checked={selection.summary} onChange={(e) => setSelection((prev) => ({ ...prev, summary: e.target.checked }))} />
            <span>{proposal.summary}</span>
          </label>
        )}

        {CATEGORIES.map((category) =>
          proposal[category].length ? (
            <section className="review-section" key={category} data-category={category}>
              <h3>
                {CATEGORY_LABELS[category]} <span className="muted small">{proposal[category].length}</span>
              </h3>
              {proposal[category].map((item, index) => (
                <label className="check" key={`${category}-${index}`}>
                  <input type="checkbox" checked={selection[category].includes(index)} onChange={() => toggle(category, index)} />
                  <span>
                    {item.text}
                    {item.due ? <em className="muted"> · due {item.due}</em> : null}
                  </span>
                </label>
              ))}
            </section>
          ) : null,
        )}
        {CATEGORIES.every((c) => proposal[c].length === 0) && <p className="muted">Nothing to keep: the notes have no tagged or inferred items.</p>}

        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => onApply(selection)}>
            Apply {kept ? `(${kept})` : ""}
          </button>
          {canRerun && (
            <button type="button" disabled={busy} onClick={onRerun} title="Ask Claude again">
              {busy ? "Asking Claude…" : "Re-run with Claude"}
            </button>
          )}
          <button type="button" disabled={busy} onClick={onDiscard}>
            Discard
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
