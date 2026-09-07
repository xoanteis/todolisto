import type { CSSProperties } from "react";

import { MAX_OPACITY, MIN_OPACITY, OPACITY_STEP, type DriveStatus, type Profile, type Session, type WindowState } from "../backend/types";
import { timeOf } from "../model/time";

interface Props {
  profiles: Profile[];
  profile: string;
  open: Session | null;
  canReopen: boolean;
  win: WindowState | null;
  onSwitch(profile: string): void;
  onEnd(): void;
  onReopen(): void;
  onPin(pinned: boolean): void;
  onOpacity(percent: number): void;
  onSearch(): void;
  drive: DriveStatus | null;
  onSync(): void;
  openTodos: number;
  pendingReviews: number;
  onDigest(): void;
  onAgent(): void;
}

function driveLabel(status: DriveStatus | null): { text: string; state: string } {
  if (!status || !status.connected || !status.enabled) return { text: "☁ off", state: "off" };
  if (status.last_error) return { text: "☁ error", state: "error" };
  if (status.syncing) return { text: "☁ syncing…", state: "syncing" };
  if (status.last_sync) return { text: `☁ ${timeOf(status.last_sync)}`, state: "ok" };
  return { text: "☁ connected", state: "ok" };
}

export function Header({ profiles, profile, open, canReopen, win, onSwitch, onEnd, onReopen, onPin, onOpacity, onSearch, drive, onSync, openTodos, pendingReviews, onDigest, onAgent }: Props) {
  const color = profiles.find((p) => p.id === profile)?.color ?? "#888";
  const sync = driveLabel(drive);
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
      <button type="button" className="search-button" onClick={onSearch} title="Search all notes (Ctrl+Shift+F)">
        Search
      </button>
      <button type="button" className="digest-button" onClick={onDigest} title="To do, facts, questions, decisions, ideas (Ctrl+T)">
        To do{openTodos ? ` ${openTodos}` : ""}
      </button>
      <button type="button" className="agent-button" data-pending={pendingReviews > 0 ? "1" : undefined} onClick={onAgent} title="Session agent settings">
        Agent{pendingReviews ? ` · ${pendingReviews} to review` : ""}
      </button>
      <button type="button" className="sync-button" data-state={sync.state} onClick={onSync} title={drive?.last_error ?? "Google Drive sync"}>
        {sync.text}
      </button>
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
      {win && (
        <>
          <label className="opacity" title="Window opacity · Ctrl+Shift+Up / Down">
            <span className="opacity-value">◐ {win.opacity}%</span>
            <input
              type="range"
              min={MIN_OPACITY}
              max={MAX_OPACITY}
              step={OPACITY_STEP}
              value={win.opacity}
              aria-label="Window opacity"
              onChange={(e) => onOpacity(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className={win.pinned ? "pin active" : "pin"}
            aria-pressed={win.pinned}
            title={win.pinned ? "Unpin: let other windows cover this one" : "Pin: keep on top of other windows"}
            onClick={() => onPin(!win.pinned)}
          >
            {win.pinned ? "Pinned" : "Pin"}
          </button>
        </>
      )}
    </header>
  );
}
