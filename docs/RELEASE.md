# Getting the app and cutting releases

## From a CI run (any push)

Every push runs the `build` workflow. Its `windows exe` job uploads
`todolisto-portable-win64` as an artifact: open the run under **Actions**
on GitHub, scroll to **Artifacts**, download the zip (a GitHub login is
needed; artifacts expire after 30 days). Unzip anywhere and run
`todolisto.exe`; `README.txt` inside explains the portable layout.

## A tagged release (permanent download link)

```
git tag v0.1.0
git push origin v0.1.0
```

The same workflow then attaches `todolisto-portable-win64.zip` to a GitHub
release named after the tag, with generated release notes. A tag containing
a hyphen (`v0.2.0-beta1`) is marked as a pre-release.

## First run on a PC

1. Unzip, start `todolisto.exe`. The first window is centred; the position
   is remembered afterwards.
2. Windows may show the SmartScreen prompt for an unsigned exe: *More info →
   Run anyway* (the build is not code-signed).
3. Press `Ctrl+Alt+N` from any app to bring the window back; `Esc` hides it.
4. Optional: the cloud button for Google Drive sync (`docs/GOOGLE_DRIVE.md`),
   the *Agent* button for the Anthropic API key.

## Building locally on Windows

Requirements: Node 22, Rust stable (rustup), the Visual Studio C++ build
tools (Rust's MSVC toolchain installs them), WebView2 (present).

```
npm ci
npm run tauri dev            # development build with hot reload
npm run tauri build -- --no-bundle
# -> target\release\todolisto.exe
```
