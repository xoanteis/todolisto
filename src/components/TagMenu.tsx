import type { TagMenu as TagMenuState } from "../editor/tagPlugin";

interface Props {
  menu: TagMenuState;
  onPick(tag: string): void;
}

export function TagMenu({ menu, onPick }: Props) {
  return (
    <div className="suggestions tags" role="listbox" style={{ left: menu.left, top: menu.top + 4 }} onMouseDown={(e) => e.preventDefault()}>
      {menu.options.map((tag, i) => (
        <button type="button" role="option" aria-selected={i === menu.index} key={tag} className={i === menu.index ? "suggestion active" : "suggestion"} onClick={() => onPick(tag)}>
          #{tag}
        </button>
      ))}
      <div className="suggestion muted small">Tab or Enter completes · Esc closes</div>
    </div>
  );
}
