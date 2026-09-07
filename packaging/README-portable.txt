todolisto - portable build
==========================

1. Unzip this folder anywhere (a USB stick, a synced folder, C:\Tools\todolisto).
2. Run todolisto.exe.

The file "portable.marker" next to the exe tells todolisto to keep everything
in this folder:

  config\settings.json   profiles and preferences
  data\<profile>\<year>\ one .jsonl file per session (+ a .md copy once closed)
  cache\                 rebuildable caches, safe to delete

Delete "portable.marker" if you prefer the data under %APPDATA%\todolisto.
Back up = copy the folder.

Requirements: Windows 10 or 11 with the Microsoft Edge WebView2 runtime
(already present on Windows 11 and on updated Windows 10). If todolisto
reports that it is missing, install it from
https://developer.microsoft.com/microsoft-edge/webview2/

Keys
  Ctrl+Alt+N          show / hide todolisto from any app (global hotkey)
  Esc                 hide the window
  Enter               new line inside the current entry
  Shift+Enter         new entry with a new timestamp
  Ctrl+Enter          end the session
  Ctrl+Shift+Enter    reopen the last session
  Ctrl+End            jump to the live entry
  Ctrl+Shift+Up/Down  window opacity
  Ctrl+Z / Ctrl+Y     undo / redo
  Right click / Ctrl+. suggestions for a misspelled word
  Ctrl+Shift+F        search all notes (#tag filters, accents optional)
  Ctrl+F              search inside the open session

The close button hides the window to the tray icon; use the tray menu to
quit. Starting todolisto.exe again just brings the running window back.
Hotkey, opacity, pin and the other options live in config\settings.json.

Sessions also close by themselves after 90 minutes without writing
(config\settings.json, "inactivity_minutes"; 0 disables it).

Google Drive sync: click the cloud button in the top bar. The setup guide
is docs/GOOGLE_DRIVE.md in the repository (an OAuth client of your own,
about ten minutes, once). Each profile signs in with its own account.
