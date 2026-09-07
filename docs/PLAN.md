# todolisto — scoping plan (v0.2, 2026-09-07)

Status: **scope agreed, implementation started**. Section 0 lists the decisions taken from
the answers to section 6; the rest of the document is the reasoning behind them.

---

## 0. Decisions (2026-09-07)

Defaults from section 6 apply unless a row says otherwise. Bold = changed from the default.

| Topic | Decision |
|---|---|
| Layout | A: page with a timestamp gutter |
| Timestamp unit | One per entry |
| Keys | **Enter = new line inside the same entry; Shift+Enter = new entry with a new timestamp.** Ctrl+Enter ends the session |
| Editing the past | Editable while the session is open (original timestamp kept, `edited` mark added); read-only after closing unless reopened |
| Session end | Manual (Ctrl+Enter) **and automatic after inactivity** (default 90 min; the session closes at the time of its last entry with reason `inactivity`; "Reopen last session" is one shortcut away). The answer said "4" but described question 5; interpreted that way |
| Entry types | Inline `#tags` plus agent inference |
| Spelling | en_US, es_ES and gl_ES active at once; safe autocorrect by default, aggressive opt-in |
| Storage | JSONL canonical, rendered Markdown copy per closed session |
| Data root | Next to the exe when `portable.marker` exists, otherwise `%APPDATA%\todolisto` |
| Sync | **Google Drive API only**; no Drive-for-Desktop backend. One Google account per profile |
| Profiles | `work` and `personal`; one hotkey plus a switcher |
| Window | Ctrl+Alt+N, 90 % opacity, always-on-top off unless pinned |
| Agent | In-app through the Claude API, review before applying. **GitHub issue creation is dropped for now**; the first actions are local (session title and summary, TODO list, facts) |
| Secrets | DPAPI-encrypted file next to the config |
| UI language | English |
| Machines | **Windows 10 and 11, several PCs.** Every PC must show the same stream, so sync is a first-class feature with explicit multi-device rules (section 4.5) |
| Stack | Rust + Tauri 2, as recommended |
| Never | No telemetry. Network only for sync and for the agent |

---

## 1. What we are building

A **portable Windows desktop app** that replaces Notepad (and a few other tools) for
notes taken during meetings and brainstorming sessions.

Core behaviour, as requested:

- Blank-page editor with a Google-Docs feel, but **every entry is timestamped**
  (date, hour, minute, second). An entry can span several lines under one timestamp.
- An **infinite chronological stream**: today's notes are just the bottom of the same
  document that contains every past session.
- **Writing speed first**: spell check and autocorrect in **English, Spanish and Galician**,
  no formatting toolbar, no dialogs while typing.
- **Semi-structured**: entries can be TODOs, key data to remember, ideas, questions,
  decisions… without slowing the writer down.
- **Sessions**: an explicit "end of session" mark (end of the meeting, end of the
  brainstorm), or an automatic one after a period of inactivity. Ending a session hands
  it to an **agent** that titles and summarises it and extracts TODOs, facts and
  questions. Creating GitHub issues from the TODOs is a later executor.
- **Profiles** (work, personal, …): each with its own storage, Google account and GitHub target.
- **Global hotkey** that brings the app to the front, with **adjustable transparency**.
- **Storage** that is convenient for agents, fast when looking at old notes, trivial to back
  up, and **synced to Google Drive** (Drive API), one Google account per profile.
- **Several PCs** (Windows 10 and 11) that must all show the same stream.

Non-goals for v1 (can be revisited): mobile/web client, real-time collaboration, rich text
(bold, tables, images), audio recording or transcription, being a general Markdown editor.

---

## 2. Stack decision

**Recommended: Tauri 2 (Rust core) + TypeScript/React UI + ProseMirror editor + plain-file
storage (JSONL) with a local SQLite FTS5 index. Windows binaries built by GitHub Actions.**

| Concern | Tauri 2 (recommended) | Electron | .NET (WPF / WinUI 3) | Avalonia / Flutter |
|---|---|---|---|---|
| Portable single `.exe` | Yes, ~10-15 MB; needs the WebView2 runtime (ships with Windows 11 and updated Windows 10) | Yes, but ~150-200 MB folder or self-extracting exe | Yes; framework-dependent ~5 MB or self-contained ~70 MB | Yes, ~30-60 MB |
| Editor quality (IME, undo, selection, long docs) | Web editors (ProseMirror/CodeMirror), excellent | Same | WPF `RichTextBox` is weak; WinUI `RichEditBox` is OK | Custom editor work needed |
| Spell check en/es/gl | Bundled Hunspell dictionaries in-app (see 4.3) | Chromium spellcheck (no Galician dictionary), so bundled Hunspell anyway | WPF built-in only en/fr/de/es; custom lexicons for gl | None built in |
| Global hotkey, transparency, always-on-top, tray | Plugins + a few lines of Win32 in Rust | Built in | Built in (Win32) | Partial |
| Drive API, GitHub API, Claude API | Rust `reqwest`, key material stays out of the webview | Node | .NET HttpClient | Depends |
| Build without a Windows machine | GitHub Actions `windows-latest` | Same | Same | Same |
| Long-term maintenance for an agent-written codebase | Rust types + TS types; small surface | JS only | C# | C#/Dart |

Why not the alternatives: Electron costs 10x the size for no functional gain here (its
built-in spellchecker does not cover Galician, so we would bundle dictionaries either way).
.NET keeps everything native but its text controls make the "living document with a
timestamp gutter" much harder than a ProseMirror document. Avalonia/Flutter have no spell
check story at all.

Facts checked while deciding (2026-09-07):

- **WebView2's native spellcheck is single-language**: it uses the environment language
  only and ignores per-element `lang` attributes (WebView2Feedback issues #5294, #914,
  #3758). Multilingual writing needs our own dictionary layer. This is equally true for
  Electron, so it does not favour it.
- **Galician Hunspell dictionary exists** (`gl_ES.aff/.dic`, Proxecto Trasno, GPLv3, now
  maintained at gitlab.com/proxecto-trasno/hunspell-gl; ~86k lemmas). Spanish (`rla-es`)
  and English (SCOWL) dictionaries are the ones LibreOffice ships.
- **Tauri 2 transparent windows work on Windows** (`transparent: true` together with
  `decorations: false`). There is no built-in "window opacity" API, so whole-window alpha
  will be done with the Win32 layered-window call from Rust (~20 lines). Text can stay
  crisp while the background is translucent by using CSS alpha instead; both modes planned.
- **Google OAuth**: an OAuth consent screen left in *Testing* status issues refresh tokens
  that **expire after 7 days**. The fix is to set the app to *In production*, which needs
  no Google verification when the only scopes are non-sensitive (`drive.file`,
  `drive.appdata`). Full `drive` scope is restricted and would trigger verification. To be
  confirmed in the Cloud Console when we get there (Google's docs are not reachable from
  the environment where this plan was written).

Development workflow: I work in a Linux container, so the pure logic (storage, parsing,
sync engine, agent extraction, spell layer) gets unit tests that run anywhere, and the
Windows-only bits (hotkey, opacity, WebView2 rendering, portable paths) are verified through
the CI-built exe on your machine. Every milestone ends with a downloadable build attached
to a GitHub Release (pre-release tag), so you never need the Rust toolchain unless you
want to build locally.

---

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│ todolisto.exe (Tauri 2)                                               │
│                                                                       │
│   WebView2 · TypeScript/React            Rust core                    │
│  ┌──────────────────────────────┐       ┌───────────────────────────┐ │
│  │ Stream editor (ProseMirror)  │ IPC   │ Store: JSONL files +      │ │
│  │  · timestamp gutter          │◄─────►│   SQLite FTS5 index       │ │
│  │  · entry types / tags        │       │ Sessions & profiles       │ │
│  │  · virtualised history       │       │ Window: hotkey, opacity,  │ │
│  │ Spell + autocorrect worker   │       │   always-on-top, tray     │ │
│  │  (Hunspell dictionaries)     │       │ Sync: Google Drive        │ │
│  │ Search, session review panel │       │ Agent runner (Claude API) │ │
│  └──────────────────────────────┘       │ GitHub client             │ │
│                                         │ Secrets (DPAPI)           │ │
│                                         └───────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
          │ portable data folder                       │ HTTPS
          ▼                                            ▼
  <exe folder>\data\<profile>\...        Google Drive · GitHub · Anthropic
```

Principles:

1. **Local-first.** Every keystroke is saved locally (debounced, atomic write). Drive,
   GitHub and the agent are asynchronous and optional; the app is fully usable offline.
2. **Plain files are the truth.** The SQLite index is a cache that can be rebuilt from the
   files at any time (`Rebuild index` menu item).
3. **Secrets never enter the webview.** OAuth tokens, PATs and API keys live in the Rust
   side, encrypted on disk.
4. **Agents get the same files you do.** No proprietary blob to decode.

---

## 4. Options and recommendations

### 4.1 UI layout

**Option A — page with a timestamp gutter (recommended).** One document. Each entry is a
paragraph; its timestamp lives in a light-grey left gutter, set when you start typing the
entry. Past sessions are collapsed blocks above (header with date, title, summary), loaded
lazily as you scroll up, so the document is effectively infinite.

```
 todolisto · work ▾                                   ⊤ pin   ◐ 90%   ⋯
 ───────────────────────────────────────────────────────────────────────
 ▸ Fri 4 Sep · Weekly sync (8 entries, 2 todos)
 ▸ Mon 7 Sep · 08:50 Standup (5 entries)
 ───────────────────────────────────────────────────────────────────────
 Mon 7 Sep 2026 · session open since 09:31
 09:31:05  Kickoff with ACME about the migration
 09:32:40  #todo Ask Maria for the Q4 budget numbers
 09:35:02  Their API rate limit is 600 req/min per key #data
           second line of the same entry (Enter)
 09:41:17  #idea cache the report per tenant
 09:44:03  ▍
 ───────────────────────────────────────────────────────────────────────
 EN·ES·GL   autocorrect: safe        Ctrl+Enter ends the session
```

**Option B — log / chat style.** Input box pinned at the bottom, entries stack above it,
newest at the bottom. Fastest for one-liners, feels less like a document, editing older
entries is clunkier.

**Option C — Notepad `.LOG` style.** A plain text area where the app inserts a
`[2026-09-07 09:31:05]` prefix when you start a new line. Simplest possible thing, zero
structure, everything is text. Could be the very first milestone even if we end at A.

Keyboard model for A (decided): `Enter` = new line inside the same entry;
`Shift+Enter` = new entry with a new timestamp; `Ctrl+Enter` = end session;
`Ctrl+Shift+Enter` = reopen the last session; `Ctrl+End` = jump to the live entry;
`Ctrl+P` = profile switcher; `Ctrl+F` = find in session; `Ctrl+Shift+F` = search
everything; `Esc` = hide window (when opened via hotkey). An entry receives its
timestamp at the first character typed into it, not when the empty line appears.

Timestamp display: `HH:MM:SS`, with a date separator once per day; hover shows the full
value with timezone. Internally we store milliseconds and the UTC offset.

### 4.2 Entry types (semi-structure without friction)

1. **Inline tags (recommended).** Type `#todo`, `#idea`, `#data`, `#q` (open question),
   `#decision`, `@person` anywhere in the entry. A small autocomplete pops up after `#`.
   Tags stay as text in the entry and are also extracted into the `tags` field. No mode
   switching, works with any keyboard layout.
2. **Prefix syntax.** `- [ ]` for todos, `?` for questions, `!` for important, like a
   Markdown checklist. Familiar, but easy to mistype and collides with normal prose.
3. **Keyboard commands.** `Ctrl+1..5` sets the type of the current entry, shown as a
   coloured pill in the gutter. Precise, invisible in the text, but you have to remember it.
4. **Agent classification only.** Write plain prose; the session-end agent decides what
   is a TODO. Lowest friction, least control.

Recommendation: 1 as the explicit signal, 4 as the safety net (the agent also proposes
TODOs it finds in untagged prose, clearly marked as "inferred" in the review panel).

### 4.3 Spell check and autocorrect

- **Dictionaries bundled with the app**: `en_US` (or `en_GB`), `es_ES`, `gl_ES`. Checked in
  a Web Worker with `nspell` (pure JS Hunspell implementation) so typing never stalls.
- **Multi-language by default**: a word is accepted if *any* enabled dictionary accepts it.
  Spanish and Galician overlap heavily, and mixed-language meeting notes are the norm, so
  the union avoids false positives without asking you to switch languages.
  Alternatives: per-entry language auto-detection (n-gram detector, feeds a `lang` field
  the agent can use) or a manual `Ctrl+L` toggle. All three can coexist.
- **Misspellings**: dotted underline; `Ctrl+.` or right-click shows suggestions;
  "Add to dictionary" writes to a per-profile `dictionary.txt` (synced with the notes).
- **Autocorrect levels** (per profile):
  - **L0** off.
  - **L1 "safe" (recommended default)**: curated typo lists per language (`teh→the`,
    `qeu→que`, `tamen→tamén`…), your own expansions (`tbd→to be defined`), double-space
    and capital-letter fixes at sentence start (optional).
  - **L2 "aggressive"**: on space, replace a misspelled word when a dictionary offers
    exactly one suggestion at edit distance 1. `Backspace` right after the replacement
    restores the original (Word-style). Risky across three languages, hence opt-in.
- **Not using WebView2's built-in spellcheck** because it is single-language (see 2).
- Later: an optional LLM "clean up typos in this session" action that keeps the original
  text in the file and stores the cleaned version alongside.

### 4.4 Storage format

Requirements: agent-friendly, fast for old notes, easy to back up, sync-friendly, robust
against crashes.

| Option | Agent-friendly | Human-readable | Fast search | Sync/backup | Notes |
|---|---|---|---|---|---|
| **A. JSONL, one file per session (recommended canonical)** | Excellent (one line = one record) | Good | Via index | Small immutable files, diff-friendly | Multi-line text is trivially escaped |
| B. Markdown, one file per session, strict line grammar | Good (needs a parser) | Excellent | Via index | Same | `[09:31:05] text` + indented continuation lines; ambiguity risk |
| C. SQLite only | Poor (binary, needs tooling) | Poor | Excellent | One big file, conflicts on multi-device | |
| **D. Hybrid: A (or B) + local SQLite FTS5 index (recommended)** | Excellent | Good | Excellent | Files sync, index is local | Index rebuildable from files |

Recommendation: **D with JSONL canonical files, plus a rendered Markdown copy per closed
session** (so notes are readable in Drive's preview and in any editor). The Markdown copy is
derived, never edited.

Implementation note (M4): the SQLite index was not needed. A personal corpus (tens of
thousands of entries at most) is scanned in memory in milliseconds, so search runs over the
parsed sessions cached by the app and no native database is shipped. The index remains an
option if a corpus ever grows beyond that.

Draft record format (one JSON object per line):

```jsonl
{"kind":"session","id":"01J9Z6K3...","profile":"work","started":"2026-09-07T09:31:05.123+02:00","tz":"Europe/Madrid","title":null,"app":"todolisto/0.1.0"}
{"kind":"entry","id":"01J9Z6K4...","ts":"2026-09-07T09:31:05.123+02:00","text":"Kickoff with ACME about the migration","tags":[]}
{"kind":"entry","id":"01J9Z6M1...","ts":"2026-09-07T09:32:40.502+02:00","text":"#todo Ask Maria for the Q4 budget numbers","tags":["todo"]}
{"kind":"entry","id":"01J9Z6N8...","ts":"2026-09-07T09:35:02.010+02:00","text":"Their API rate limit is 600 req/min per key #data\nsecond line of the same entry","tags":["data"],"edited":"2026-09-07T09:36:11.000+02:00"}
{"kind":"session_end","ended":"2026-09-07T10:45:12.000+02:00","entries":4,"title":"Kickoff with ACME"}
{"kind":"action","entry":"01J9Z6M1...","type":"github_issue","url":"https://github.com/xoanteis/todolisto/issues/12","at":"2026-09-07T10:46:30.000+02:00"}
```

- IDs are ULIDs (time-sortable, no coordination needed).
- Timestamps are RFC 3339 with the local UTC offset, plus the timezone name in the session
  header, so agents can reason in your local time.
- While a session is **open**, the app owns its file and rewrites it atomically on each
  save (files are a few KB). Once **closed**, the file is only ever appended to (`action`
  records), which keeps sync simple and makes "the last session" a single file the agent
  can read.

Folder layout (portable by default):

```
<exe folder>\
  todolisto.exe
  portable.marker              # presence => everything lives here, not in %APPDATA%
  config\
    settings.json              # profiles, hotkey, opacity, languages (no secrets)
    secrets.bin                # DPAPI-encrypted tokens (see 4.10)
  data\
    work\
      2026\
        2026-09-07T093105_kickoff-with-acme.jsonl
        2026-09-07T093105_kickoff-with-acme.md
      dictionary.txt           # your added words
    personal\
      ...
  cache\
    index.sqlite               # FTS5 index, never synced, rebuildable
```

Backup = copy `data\` (or rely on Drive). Restore = paste it back and rebuild the index.

### 4.5 Sync with Google Drive (decided: Drive API only)

OAuth 2.0 desktop flow (the browser opens, loopback redirect), scope `drive.file` (the app
sees only files it created), one Google account per profile. You create a Google Cloud
project and an OAuth client ID once (step-by-step guide to be written in M5). The consent
screen must be set to *In production* or refresh tokens die every 7 days; no verification is
required with non-sensitive scopes only.

Caveats: a Google Workspace admin can block unverified third-party apps for the work
account (fallback: create the OAuth client as an *Internal* app inside the work
organisation); `drive.file` access is tied to the OAuth client ID, so the client must stay
the same forever, or old files have to be re-authorised.

Multi-PC rules (Windows 10 and 11, several machines, same stream everywhere):

- Every PC keeps a full local copy; Drive is the meeting point, never the only copy.
- Each session file records the `device` that created it. A session that is still open
  is **owned by that device**: other PCs show it read-only with a "take over" action
  (which closes it there and continues in a new session locally), so two machines never
  rewrite the same open file.
- Closed sessions are immutable except for appended records, so they never conflict.
- Sync runs at start, every ~30 s while a session is open, on session close, and on
  window focus. It uses the Drive `changes` feed, so a PC that was off for a week
  catches up in one request.
- If a conflict still happens (same file changed on both sides), both versions are kept
  side by side and flagged in the UI; Drive revisions remain as a backstop.
- Settings and the per-profile user dictionary are synced too, with a per-device
  override for the hotkey. The search index is never synced; each PC rebuilds it.
- Windows 10 machines without the WebView2 runtime get a clear message with the
  download link at first start instead of a blank window.

Rejected for now: a Google-Drive-for-Desktop folder backend (no OAuth, but not every PC
runs the Drive client and it hides conflicts).

### 4.6 The session-end agent

Trigger: `Ctrl+Enter` / "End session" button. Pipeline:

1. **Deterministic pass** (offline): collect tagged entries (`#todo`, `#q`, …).
2. **LLM pass** (Claude API, `claude-opus-5`, structured output against a JSON schema):
   input = the session file + profile context (target repo, labels, a glossary of people
   and projects). Output = todos (title, body, labels, priority, due, source entry ids),
   key data, open questions, decisions, ideas, a 3-line summary and a session title.
3. **Review panel** (human in the loop, default): proposed actions with checkboxes and
   editable titles. "Apply" runs the executors. An "auto-apply" toggle can come later.
4. **Executors**: v1 = local actions: write the title and summary into the session,
   keep a per-profile TODO list (with done/undone state) and a "facts" notebook. Later:
   GitHub issues (deferred by decision), calendar events, email drafts, weekly digest,
   follow-up reminders.
5. **Write-back**: every executed action is appended to the session file (`action`
   records with the issue URL), and the entry shows a small link in the gutter.

Where the agent runs — options:

- **In-app (recommended)**: the Rust core calls the Anthropic Messages API directly over
  HTTPS with your API key. No extra process, works from the portable folder, key never
  reaches the webview. Roughly a few cents per hour-long session.
- **Node sidecar** using the TypeScript SDK's tool runner: more agentic flexibility,
  one more binary to ship.
- **External**: the session file lands in Drive (or a private repo) and a scheduled Claude
  Code routine with the Drive + GitHub connectors, or a GitHub Action, processes it. The
  app stays dumb; latency is minutes instead of seconds.
- **Managed Agents** (Anthropic-hosted): overkill for v1, natural if actions multiply.

### 4.7 GitHub integration (deferred)

Dropped from the initial scope on 2026-09-07; kept here for when it comes back.

- Auth: a fine-grained personal access token with *Issues: read & write* on the target
  repo(s), one per profile. A GitHub App with the device flow is the nicer, heavier option.
- Targets: a default repo per profile, overridable per entry with a tag like
  `#repo:owner/name`. Labels: `todolisto` plus whatever you use (`meeting`, `idea`).
- Deduplication: the issue body carries a hidden marker with the entry id; re-running the
  agent on the same session updates instead of duplicating.
- Issue body: the entry text, session title and date, the surrounding entries for context
  (configurable), no private notes beyond that.

### 4.8 Profiles

A profile = name, colour, data folder, languages, autocorrect level, opacity, sync backend +
Google account, GitHub repo + token, agent on/off. Switching: `Ctrl+P` palette or the
dropdown in the title bar; the current profile is visible at all times (colour accent) so a
work note never lands in personal by accident. Optional: one hotkey per profile
(`Ctrl+Alt+1` work, `Ctrl+Alt+2` personal) instead of one hotkey + switcher.

### 4.9 Global hotkey, transparency, window behaviour

- Global hotkey (default proposal `Ctrl+Alt+N`; `Win+…` combinations are mostly reserved)
  toggles the window: show + focus + caret at the live entry, press again (or `Esc`) to
  hide. Windows restricts stealing focus; the Rust side applies the standard workaround
  so the window really comes to the front instead of blinking in the taskbar.
- Transparency: a per-profile opacity value (default 90%), adjustable with
  `Ctrl+Alt+Wheel` and a slider, persisted. Two modes: whole-window alpha (everything
  translucent) or "glass" (translucent background, opaque text).
- Always-on-top toggle ("pin"), system tray icon with close-to-tray, optional start with
  Windows (a shortcut in the Startup folder, portable-friendly).
- "Meeting mode" shortcut: pin + compact width + chosen opacity in one keystroke.

### 4.10 Portability and secrets

- Portable mode when `portable.marker` sits next to the exe: config, data and cache stay
  in that folder; nothing is written to the registry.
- Requires the WebView2 runtime, present on Windows 11 and on updated Windows 10.
- Secrets (Drive refresh tokens, GitHub PAT, Anthropic API key):
  - **DPAPI-encrypted file in the app folder (recommended)**: portable between folders
    and drives on the same Windows user account; on another PC you log in again.
  - **Windows Credential Manager**: most secure, not portable (per machine).
  - **Passphrase-encrypted file**: portable everywhere, but you type a passphrase at start.

### 4.11 Search and history

- `Ctrl+F` searches the current session; `Ctrl+Shift+F` searches everything through the
  SQLite FTS5 index with filters (profile, date range, tag, text); a result opens the
  stream at that entry.
- A timeline sidebar lists sessions by day; TODOs with their GitHub state; "facts" view of
  `#data` entries.
- Export a session as Markdown / copy to clipboard; "Reopen session" to add late entries.

---

## 5. Milestones

Each milestone is one pull request and ends with a downloadable Windows build.

| # | Milestone | You get |
|---|---|---|
| M0 ✅ | Scaffold: Tauri 2 + React + CI producing a portable exe, portable folder detection, one profile | An exe that opens a window and saves a text file |
| M1 ✅ | Editor MVP: stream editor, timestamps, multi-line entries, JSONL storage, autosave, end session, past sessions collapsed, light/dark | Notepad replacement, already usable daily |
| M2 | Writing aids: Hunspell en/es/gl, underline + suggestions, user dictionary, autocorrect L1 (L2 opt-in), tag autocomplete | Fast, multilingual typing |
| M3 ✅ | Window: global hotkey, opacity, always-on-top, tray, remembered position, single instance, profile switching | The "bring it in front of me" workflow |
| M4 ✅ | Search and history: in-memory search (no SQLite needed at this scale), global and per-session search with tag/date filters, jump to the note, copy session as Markdown | Fast access to the past |
| M5 ✅ | Google Drive sync: OAuth `drive.file` with PKCE, per-profile account, background sync every 30 s and on session end, conflict copies, sessions owned by the PC that started them. Not yet: settings sync, "take over" of a session open elsewhere | The same stream on every PC |
| M6 ✅ | Session agent: Claude extraction with structured output (tag-only mode without a key), review panel, title/summary write-back, to-do digest with done state, facts/questions/decisions/ideas | Sessions become actionable |
| M7 | Polish: settings UI, backup/restore, auto-update; later executors (GitHub issues, calendar, digest) | Daily-driver quality |

Order is negotiable: M3 can move before M2 if the hotkey matters more than spell check.

---

## 6. Questions (answered 2026-09-07, kept for the record)

The answers are consolidated in section 0.

1. **Layout**: A (page + gutter), B (log), or C (Notepad `.LOG`)? Default: A.
2. **What gets a timestamp**: each entry created with `Enter` (default), or every sentence
   (auto-split on `. `)?
3. **Keys**: `Enter` = new entry, `Shift+Enter` = new line (default), or the reverse?
4. **Editing the past**: while a session is open, any entry is editable and keeps its
   original timestamp plus an `edited` mark (default). After closing, read-only unless you
   "reopen". OK?
5. **Session end**: only manual `Ctrl+Enter` (default), or also auto-close after N minutes
   of inactivity with a prompt on the next keystroke ("continue or new session?")?
6. **Entry types**: inline tags (`#todo #idea #data #q #decision @person`) + agent
   inference (default)? Which tag names do you actually want?
7. **Spelling**: `en_US` or `en_GB`? All three dictionaries active at once (default)?
   Autocorrect L1 default, L2 opt-in?
8. **Storage**: JSONL canonical + Markdown copy (default), or Markdown canonical?
9. **Data root**: `<exe folder>\data` (default) or somewhere else (e.g. inside your Drive
   folder)?
10. **Sync**: both backends (default), Drive API only, or Drive-for-Desktop folder only?
    Are you fine creating a Google Cloud project + OAuth client with your personal account?
    Does your work Google Workspace allow unverified third-party OAuth apps?
11. **Profiles**: start with `work` and `personal`? One hotkey + switcher (default) or one
    hotkey per profile?
12. **Hotkey and window**: `Ctrl+Alt+N` (default)? Default opacity 90%? Always-on-top by
    default (default: no, toggle with a pin)?
13. **Agent runtime**: in-app via the Claude API with your own Anthropic API key
    (default), or external (Claude Code routine / GitHub Action)? Review before applying
    (default) or auto-apply?
14. **GitHub**: which repo receives the TODO issues for each profile? Labels? Fine-grained
    PAT (default) or GitHub App?
15. **Secrets**: DPAPI file (default), Credential Manager, or passphrase?
16. **UI language**: English (default) or Galician/Spanish?
17. **Your Windows**: 10 or 11? One PC or several (sync priority)?
18. **Stack**: any objection to Rust + Tauri (default), or would you rather have
    Electron (JS only, bigger) or .NET?
19. **Anything the app must never do** (e.g. no network unless you trigger sync, no
    telemetry — the default is no telemetry at all)?

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| WebView2 spellcheck is single-language | Bundled Hunspell dictionaries and our own checker (decided) |
| Work Workspace blocks the OAuth app | Drive-for-Desktop backend; or an *Internal* OAuth app created in the work Cloud org |
| `drive.file` only sees files created by this OAuth client | Keep the client ID stable; document recovery (re-authorise via picker); full `drive` scope as last resort (needs verification) |
| Windows refuses to bring a window to the foreground | Standard `AttachThreadInput`/keystroke workaround in Rust, tested in M3 |
| Transparent window rendering quirks with WebView2 | Prototype in M0, fall back to "glass" mode if whole-window alpha misbehaves |
| Cannot build Windows binaries in the Linux dev container | GitHub Actions `windows-latest` builds every milestone |
| Dictionary licences (GPL for `gl_ES`, tri-licence for `es_ES`) | Ship as separate data files with their notices; the app stays Apache-2.0 |
| Agent proposes wrong TODOs or titles | Review panel by default; nothing is written without confirmation |
| Two PCs write to the same open session | Open sessions are owned by one device; other PCs are read-only until "take over" |
| Autocorrect "fixes" a correct Galician word into Spanish | Union of dictionaries before correcting; L2 opt-in; one-key revert |
