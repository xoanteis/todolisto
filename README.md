# todolisto

Quick notes and actions. A portable Windows app for meeting and brainstorming
notes: a blank page where every entry is timestamped to the second, grouped in
sessions, stored as plain JSONL files that agents can read.

Scoping plan, decisions and roadmap: [docs/PLAN.md](docs/PLAN.md).

## Status

Milestones M1 to M6 of the plan: timestamped entries, multi-line entries,
sessions with manual and automatic close, per-profile storage, history of
past sessions, spell check in English, Spanish and Galician with
suggestions and a personal dictionary, safe autocorrect, global hotkey
(Ctrl+Alt+N), window opacity, pin on top, tray icon, remembered window
position, single instance, search across all notes with tag and date
filters, copy a session as Markdown, Google Drive sync per profile with
conflict copies, and a session agent that turns a finished session into a
title, a summary, to-dos, facts, questions, decisions and ideas you review
before they are saved.

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
| # | Tag completion: the standard tags (`#todo #data #q #idea #decision`) and the ones you used before; Tab or Enter completes |
| Right click or Ctrl+. | Suggestions for a misspelled word, add it to the dictionary, or ignore it |
| Ctrl+Shift+F | Search everything (`#tag` filters, accents optional); Enter jumps to the note |
| Ctrl+F | Search inside the open session |
| Ctrl+T | To-dos, facts, questions, decisions and ideas kept from reviewed sessions |
| Backspace right after an autocorrection | Restores what you typed |

The close button hides the window to the tray (`close_to_tray`); quit from
the tray menu. Sessions also close by themselves after 90 minutes without
writing (`inactivity_minutes`, 0 disables it).

## Session agent

When a session ends, the agent proposes a title, a two-line summary and
the actionable items it finds. Nothing is written until you review the
proposal (banner at the top, or the *Review* button of the session in the
history). Applied items land in the session file as an `action` record
and in its Markdown copy; to-dos get a done state in
`data/<profile>/todos.json` (synced) and are listed with Ctrl+T.

Without an API key the agent only sorts your `#tags` (`#todo`, `#data`,
`#q`, `#decision`, `#idea`). With an Anthropic API key (top bar → *Agent*),
the notes of that one session are sent to Claude (`claude-opus-5` by
default, structured JSON answer, server-side refusal fallback) and the
tagged entries are merged in so none is lost. The key is stored encrypted
in `config/secrets.bin`; a session costs a few cents. `agent_enabled`,
`agent_auto` and `agent_model` live in the settings.

## Sync

Each profile can sync with its own Google account through the Drive API
(`todolisto/<profile>` in that Drive): sessions, Markdown copies, the
personal dictionary and autocorrect rules, every 30 seconds and when a
session ends. Setup and behaviour: [docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md).

## Search

Search scans every session of the profile in memory: case and accents are
ignored (`reunion` finds `reunión`), every word must appear, phrases rank
first, `#tag` words filter by tag, and quick ranges limit the dates. A
personal corpus is small enough that this answers in milliseconds, so
there is no database to keep in sync; the plan's SQLite index stays an
option if a corpus ever grows large.

## Spelling

Real Hunspell (compiled to WebAssembly) runs inside the app with the
dictionaries in `public/dict` (see `public/dict/NOTICE.md` for sources and
licences). A word is accepted when any active language accepts it, so
mixed-language notes get no false alarms. Settings: `languages` (subset of
`en`, `es`, `gl`), `spellcheck` (on/off), `autocorrect` (`off`, `safe`,
`aggressive`). `safe` applies a curated list of unambiguous typos plus your
own rules from `data/<profile>/autocorrect.txt` (`wrong=right` per line);
`aggressive` also replaces a misspelled word when exactly one dictionary
suggestion is one edit away. Words you add live in
`data/<profile>/dictionary.txt`.

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
config/settings.json                                   profiles and preferences (incl. the Google OAuth client)
config/window.json                                     last window position on this machine
config/secrets.bin                                     Google refresh tokens, DPAPI-encrypted, never synced
cache/sync/<profile>.json                              sync state (safe to delete)
data/<profile>/dictionary.txt                          words added to the spell checker
data/<profile>/autocorrect.txt                         personal autocorrect rules (wrong=right)
data/<profile>/todos.json                              done state of the to-dos
cache/agent/<profile>/<session>.json                   proposals waiting for review
data/<profile>/<year>/<YYYY-MM-DDTHHMMSS>_<id>.jsonl   one file per session
data/<profile>/<year>/<same stem>.md                   rendered copy of a closed session
```

Each `.jsonl` line is a record: `session` (header), `entry`, `session_end`,
`action` (the agent's kept items, `type: "agent"`). Timestamps are RFC 3339
with the local offset.

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
npm run validate:rules # built-in autocorrect keys must be misspellings in every dictionary
cargo test -p todolisto-core
npm run tauri build -- --no-bundle   # target/release/todolisto.exe
```

## Releases

Every push builds `todolisto-portable-win64.zip` as a workflow artifact.
Pushing a tag `vX.Y.Z` attaches the zip to a GitHub release.
