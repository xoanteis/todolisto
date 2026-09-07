import { useEffect, useState } from "react";

import type { AgentStatus, Settings } from "../backend/types";

interface Props {
  settings: Settings;
  status: AgentStatus | null;
  onSaveKey(key: string): void;
  onSaveSettings(patch: Partial<Settings>): void;
  onClose(): void;
}

const MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 (default)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (cheaper)" },
];

export function AgentDialog({ settings, status, onSaveKey, onSaveSettings, onClose }: Props) {
  const [key, setKey] = useState("");

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
      <div className="modal" role="dialog" aria-label="Session agent">
        <div className="modal-head">
          <h2>Session agent</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted small">
          When a session ends, the agent reads it and proposes a title, a summary, to-dos, facts, open questions, decisions and
          ideas. You review the proposal before anything is saved. Without an API key it only sorts your <code>#tags</code>. With
          a key, the session's notes are sent to Anthropic's API for that one request (a session costs a few cents).
        </p>

        <label className="field">
          <span>Anthropic API key</span>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={status?.has_key ? "a key is saved · paste a new one to replace it" : "sk-ant-…"} spellCheck={false} />
        </label>
        <div className="actions">
          <button type="button" disabled={!key.trim()} onClick={() => { onSaveKey(key.trim()); setKey(""); }}>
            Save key
          </button>
          {status?.has_key && (
            <button type="button" onClick={() => onSaveKey("")}>
              Remove key
            </button>
          )}
          <span className="muted small">{status?.has_key ? "key stored encrypted in config/secrets.bin" : "no key: tag-only mode"}</span>
        </div>

        <label className="field">
          <span>Model</span>
          <select value={settings.agent_model} onChange={(e) => onSaveSettings({ agent_model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!MODELS.some((m) => m.id === settings.agent_model) && <option value={settings.agent_model}>{settings.agent_model}</option>}
          </select>
        </label>
        <div className="actions">
          <label className="toggle">
            <input type="checkbox" checked={settings.agent_enabled} onChange={(e) => onSaveSettings({ agent_enabled: e.target.checked })} />
            Agent enabled
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.agent_auto} onChange={(e) => onSaveSettings({ agent_auto: e.target.checked })} />
            Run when a session ends
          </label>
        </div>
      </div>
    </div>
  );
}
