//! Where the app keeps its files.
//!
//! * `portable.marker` next to the executable: everything lives in that folder
//!   (`config/`, `data/`, `cache/`). This is the portable mode.
//! * `TODOLISTO_HOME` environment variable: explicit root (handy in development).
//! * Otherwise the per-user application data directory, `%APPDATA%\todolisto`
//!   on Windows.

use std::path::PathBuf;

pub struct AppPaths {
    pub root: PathBuf,
    pub portable: bool,
}

pub fn resolve() -> Result<AppPaths, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot locate the executable: {e}"))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "the executable has no parent directory".to_string())?
        .to_path_buf();
    if exe_dir.join("portable.marker").is_file() {
        return Ok(AppPaths { root: exe_dir, portable: true });
    }

    if let Ok(dir) = std::env::var("TODOLISTO_HOME") {
        if !dir.trim().is_empty() {
            return Ok(AppPaths { root: PathBuf::from(dir), portable: false });
        }
    }

    let base = dirs::data_dir().ok_or_else(|| "no application data directory on this system".to_string())?;
    Ok(AppPaths { root: base.join("todolisto"), portable: false })
}
