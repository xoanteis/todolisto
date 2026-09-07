import { useLayoutEffect, useRef, useState } from "react";

import type { SpellMenu } from "../editor/spellPlugin";

interface Props {
  menu: SpellMenu;
  onPick(replacement: string): void;
  onAdd(): void;
  onIgnore(): void;
}

export function SuggestionMenu({ menu, onPick, onAdd, onIgnore }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.left, top: menu.top + 4 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = menu.left;
    let top = menu.top + 4;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, menu.top - rect.height - 24);
    setPosition({ left, top });
  }, [menu]);

  // mousedown is prevented so the editor keeps focus and its selection.
  const prevent = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="suggestions" role="menu" ref={ref} style={position} onMouseDown={prevent}>
      {menu.suggestions === null ? (
        <div className="suggestion muted">Looking up “{menu.word}”…</div>
      ) : menu.suggestions.length === 0 ? (
        <div className="suggestion muted">No suggestions for “{menu.word}”</div>
      ) : (
        menu.suggestions.map((s, i) => (
          <button type="button" role="menuitem" key={s} className={i === menu.index ? "suggestion active" : "suggestion"} onClick={() => onPick(s)}>
            {s}
          </button>
        ))
      )}
      <div className="suggestion-sep" />
      <button type="button" role="menuitem" className="suggestion" onClick={onAdd}>
        Add “{menu.word}” to dictionary
      </button>
      <button type="button" role="menuitem" className="suggestion" onClick={onIgnore}>
        Ignore for this session
      </button>
    </div>
  );
}
