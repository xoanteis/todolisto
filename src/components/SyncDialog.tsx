import { useEffect, useState } from "react";

import type { DriveStatus, Profile, Settings } from "../backend/types";
import { formatDay, timeOf } from "../model/time";

interface Props {
  settings: Settings;
  statuses: Record<string, DriveStatus>;
  busy: string | null;
  onSaveClient(clientId: string, clientSecret: string): void;
  onToggle(profile: string, enabled: boolean): void;
  onConnect(profile: string): void;
  onDisconnect(profile: string): void;
  onSyncNow(profile: string): void;
  onClose(): void;
}

function lastSyncLabel(iso: string | null): string {
  if (!iso) return "never synced";
  const today = new Date().toISOString().slice(0, 10) === iso.slice(0, 10);
  return `last sync ${today ? "" : formatDay(iso) + " "}${timeOf(iso)}`;
}

export function SyncDialog({ settings, statuses, busy, onSaveClient, onToggle, onConnect, onDisconnect, onSyncNow, onClose }: Props) {
  const [clientId, setClientId] = useState(settings.google_client_id);
  const [clientSecret, setClientSecret] = useState(settings.google_client_secret);
  const configured = Boolean(settings.google_client_id && settings.google_client_secret);
  const dirty = clientId.trim() !== settings.google_client_id || clientSecret.trim() !== settings.google_client_secret;

  // Escape closes the dialog wherever the focus is (a disabled button drops it).
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

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Google Drive sync">
        <div className="modal-head">
          <h2>Google Drive sync</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <section className="modal-section">
          <h3>1. OAuth client {configured ? <span className="ok">configured</span> : <span className="pending">missing</span>}</h3>
          <p className="muted small">
            One-time setup, shared by every profile: in Google Cloud Console create a project, enable the Drive API, set the OAuth
            consent screen to <em>In production</em> with the scopes <code>drive.file</code>, <code>openid</code> and <code>email</code>, then
            create an OAuth client of type <em>Desktop app</em>. Step by step: <code>docs/GOOGLE_DRIVE.md</code> in the repository.
          </p>
          <label className="field">
            <span>Client ID</span>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} placeholder="1234567890-abc.apps.googleusercontent.com" />
          </label>
          <label className="field">
            <span>Client secret</span>
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} spellCheck={false} type="password" placeholder="GOCSPX-…" />
          </label>
          <div className="actions">
            <button type="button" disabled={!dirty} onClick={() => onSaveClient(clientId.trim(), clientSecret.trim())}>
              Save client
            </button>
          </div>
        </section>

        <section className="modal-section">
          <h3>2. Accounts, one per profile</h3>
          {settings.profiles.map((profile: Profile) => {
            const status = statuses[profile.id];
            const working = busy === profile.id;
            return (
              <div className="profile-sync" key={profile.id} data-profile={profile.id}>
                <div className="profile-sync-head">
                  <span className="dot" style={{ background: profile.color }} aria-hidden="true" />
                  <strong>{profile.name}</strong>
                  <span className="muted small status-line">
                    {!status
                      ? "…"
                      : status.connected
                        ? `${status.account ?? "connected"} · ${status.syncing ? "syncing…" : lastSyncLabel(status.last_sync)}${status.enabled ? "" : " · paused"}`
                        : "not connected"}
                  </span>
                </div>
                {status?.last_error && <div className="error small">{status.last_error}</div>}
                {status?.last_report && status.last_report.conflicts.length > 0 && (
                  <div className="warn small">
                    Both sides changed {status.last_report.conflicts.length === 1 ? "a file" : `${status.last_report.conflicts.length} files`}; the
                    other version was kept next to yours as <code>*.conflict-…</code>: {status.last_report.conflicts.join(", ")}
                  </div>
                )}
                <div className="actions">
                  {status?.connected ? (
                    <>
                      <label className="toggle">
                        <input type="checkbox" checked={status.enabled} onChange={(e) => onToggle(profile.id, e.target.checked)} />
                        Sync this profile
                      </label>
                      <button type="button" disabled={working || status.syncing || !status.enabled} onClick={() => onSyncNow(profile.id)}>
                        Sync now
                      </button>
                      <button type="button" disabled={working} onClick={() => onDisconnect(profile.id)}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={!configured || working} onClick={() => onConnect(profile.id)} title={configured ? "Opens the browser for the Google sign-in" : "Save the OAuth client first"}>
                      {working ? "Waiting for the sign-in…" : "Connect Google account"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="muted small">
            Files go to <code>todolisto/&lt;profile&gt;</code> in that account's Drive: sessions, their Markdown copies, the personal dictionary
            and autocorrect rules. Nothing is ever deleted by sync. Sessions open on another PC show up read-only here until that PC
            closes them.
          </p>
        </section>
      </div>
    </div>
  );
}
