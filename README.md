# todolisto

Quick notes and actions. A portable Windows app for meeting and brainstorming
notes: a blank page where every entry is timestamped to the second, grouped in
sessions, stored as plain JSONL files that agents can read.

Scoping plan, decisions and roadmap: [docs/PLAN.md](docs/PLAN.md).

## Status

Milestone M1 (editor MVP): timestamped entries, multi-line entries, sessions
with manual and automatic close, per-profile storage, history of past
sessions. Spell check, global hotkey, transparency, search, Drive sync and
the session agent come in the next milestones.

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
config/settings.json
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
