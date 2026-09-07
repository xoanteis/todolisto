# todolisto

Quick notes and actions. A portable Windows app for meeting and brainstorming
notes: a blank page where every entry is timestamped to the second, grouped in
sessions, stored as plain JSONL files that agents can read.

Scoping plan, decisions and roadmap: [docs/PLAN.md](docs/PLAN.md).

## Status

Milestones M1 and M3 of the plan: timestamped entries, multi-line entries,
sessions with manual and automatic close, per-profile storage, history of
past sessions, global hotkey (Ctrl+Alt+N), window opacity, pin on top,
tray icon, remembered window position, single instance. Spell check,
search, Drive sync and the session agent come in the next milestones.

## Keys

| Key | Action |
|---|---|
| Enter | New line inside the current entry |
| Shift+Enter | New entry, stamped when its first character is typed |
| Ctrl+Enter | End the session |
| Ctrl+Shift+Enter | Reopen the last session |
| Ctrl+End | Jump to the live entry |
| Ctrl+Alt+N | Show or hide the window from anywhere (`hotkey` in settings.json) |
| Esc | Hide the window (`hide_on_escape`) |
| Ctrl+Shift+Up / Down | Window opacity in 5 % steps (`opacity`, 30 to 100) |

The close button hides the window to the tray (`close_to_tray`); quit from
the tray menu. Sessions also close by themselves after 90 minutes without
writing (`inactivity_minutes`, 0 disables it).

## Layout

```
crates/core/      Rust core: model, JSONL store, Markdown export, settings (tested on any OS)
src-tauri/        Tauri 2 shell: window, IPC commands, portable paths
src/              React + TypeScript UI, ProseMirror editor
tests/            Vitest unit tests (editor model, backends, helpers)
e2e/              Playwright tests against the in-browser backend
packaging/        Files shipped in the portable zip
.github/          CI: tests on Linux, portable exe built on Windows
```

## Data

Portable mode (a `portable.marker` file next to `todolisto.exe`) keeps
everything in the exe folder; otherwise the data lives in
`%APPDATA%\todolisto`. `TODOLISTO_HOME=<dir>` overrides both.

```
config/settings.json                                   profiles and preferences
config/window.json                                     last window position on this machine
data/<profile>/<year>/<YYYY-MM-DDTHHMMSS>_<id>.jsonl   one file per session
data/<profile>/<year>/<same stem>.md                   rendered copy of a closed session
```

Each `.jsonl` line is a record: `session` (header), `entry`, `session_end`,
`action`. Timestamps are RFC 3339 with the local offset.

## Development

Requirements: Node 22, Rust stable. On Windows nothing else is needed for
`npm run tauri dev`; on Linux install the Tauri prerequisites (WebKitGTK 4.1).

```
npm ci
npm run dev            # UI only, in a browser, with an in-memory backend
npm run tauri dev      # the real app
npm run typecheck
npm test               # unit tests
npm run test:e2e       # Playwright (needs `npx playwright install chromium`)
cargo test -p todolisto-core
npm run tauri build -- --no-bundle   # target/release/todolisto.exe
```

## Releases

Every push builds `todolisto-portable-win64.zip` as a workflow artifact.
Pushing a tag `vX.Y.Z` attaches the zip to a GitHub release.
