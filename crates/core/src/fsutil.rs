//! Small filesystem helpers shared by the store and the settings.

use std::fs;
use std::io::Write;
use std::path::Path;

use crate::error::{Error, Result};

/// Writes `bytes` to `path` atomically: the content goes to a temporary file in
/// the same directory, is flushed to disk, and is then renamed over the target.
/// A crash in the middle leaves either the old file or the new one, never a
/// half-written file.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Other(format!("{} has no parent directory", path.display())))?;
    fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();

    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(Error::io(path, e));
    }
    Ok(())
}

pub fn read_to_string(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|e| Error::io(path, e))
}

pub fn remove_file_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::io(path, e)),
    }
}
