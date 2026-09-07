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
  Enter               new line inside the current entry
  Shift+Enter         new entry with a new timestamp
  Ctrl+Enter          end the session
  Ctrl+Shift+Enter    reopen the last session
  Ctrl+End            jump to the live entry
  Ctrl+Z / Ctrl+Y     undo / redo

Sessions also close by themselves after 90 minutes without writing
(config\settings.json, "inactivity_minutes"; 0 disables it).
