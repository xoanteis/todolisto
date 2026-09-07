import type { CSSProperties } from "react";

import type { Profile, Session } from "../backend/types";
import { timeOf } from "../model/time";

interface Props {
  profiles: Profile[];
  profile: string;
  open: Session | null;
  canReopen: boolean;
  onSwitch(profile: string): void;
  onEnd(): void;
  onReopen(): void;
}

export function Header({ profiles, profile, open, canReopen, onSwitch, onEnd, onReopen }: Props) {
  const color = profiles.find((p) => p.id === profile)?.color ?? "#888";
  const count = open?.entries.length ?? 0;
  const status = open
    ? `Session open since ${timeOf(open.header.started)} · ${count} ${count === 1 ? "entry" : "entries"}`
    : "No open session";

  return (
    <header className="topbar" style={{ "--accent": color } as CSSProperties}>
      <div className="brand">
        <span className="dot" aria-hidden="true" />
        todolisto
      </div>
      <select className="profile-select" value={profile} onChange={(e) => onSwitch(e.target.value)} aria-label="Profile">
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="spacer" />
      <span className="session-status">{status}</span>
      {open ? (
        <button type="button" onClick={onEnd} title="Ctrl+Enter">
          End session
        </button>
      ) : canReopen ? (
        <button type="button" onClick={onReopen} title="Ctrl+Shift+Enter">
          Reopen last
        </button>
      ) : null}
    </header>
  );
}
