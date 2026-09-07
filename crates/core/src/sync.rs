//! Sync engine, independent of Google Drive: a `Remote` is any file store that
//! can list its files with content hashes, report changes since a token,
//! download and upload. The engine keeps a small state file per profile with
//! the hash last seen on both sides of every file, which is enough to tell
//! "unchanged", "changed here", "changed there" and "changed on both sides"
//! apart without clocks.
//!
//! Rules:
//! - Files are never deleted through sync.
//! - A file changed on both sides is a conflict: the local version wins and
//!   is pushed, the remote version is kept next to it as
//!   `<stem>.conflict-<time>.<ext>` (conflict copies are never pushed).
//! - Only session files (`*.jsonl`, `*.md` under the year folders), the
//!   personal dictionary, the autocorrect rules and the to-do state are synced.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::fsutil;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    pub id: String,
    pub name: String,
    /// Lower-case hex MD5 of the content, as Drive reports it.
    pub md5: String,
    /// RFC 3339 modification time, only used to name conflict copies.
    pub modified: String,
}

#[derive(Debug, Clone, Default)]
pub struct ChangeSet {
    pub files: Vec<RemoteFile>,
    pub token: String,
}

pub trait Remote {
    /// Every file currently in the remote folder plus the token to ask for
    /// later changes.
    fn list(&mut self) -> std::result::Result<ChangeSet, String>;
    /// Files changed since `token` (new or updated; removed ones are omitted)
    /// and the token for the next call.
    fn changes(&mut self, token: &str) -> std::result::Result<ChangeSet, String>;
    fn download(&mut self, id: &str) -> std::result::Result<Vec<u8>, String>;
    /// Creates the file when `existing_id` is `None`, replaces its content
    /// otherwise.
    fn upload(&mut self, existing_id: Option<&str>, name: &str, bytes: &[u8]) -> std::result::Result<RemoteFile, String>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileState {
    pub remote_id: String,
    /// Hash of the remote content the last time we looked.
    pub remote_md5: String,
    /// Hash of the content when both sides last agreed.
    pub synced_md5: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncState {
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub files: BTreeMap<String, FileState>,
    /// Remote folder ids, cached by the caller (`root`, `profile`).
    #[serde(default)]
    pub folders: BTreeMap<String, String>,
}

impl SyncState {
    pub fn load(path: &Path) -> SyncState {
        fsutil::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(|e| Error::Other(e.to_string()))?;
        fsutil::atomic_write(path, json.as_bytes())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct SyncReport {
    pub pulled: Vec<String>,
    pub pushed: Vec<String>,
    pub conflicts: Vec<String>,
    pub unchanged: usize,
}

impl SyncReport {
    /// Whether any session file changed locally (the catalog must reload).
    pub fn sessions_changed(&self) -> bool {
        self.pulled.iter().chain(self.conflicts.iter()).any(|n| n.ends_with(".jsonl"))
    }
}

#[derive(Debug, Clone)]
pub struct LocalFile {
    pub name: String,
    pub path: PathBuf,
    pub md5: String,
}

pub fn md5_hex(bytes: &[u8]) -> String {
    format!("{:x}", md5::compute(bytes))
}

fn is_session_name(name: &str) -> bool {
    name.len() > 5 && name.as_bytes()[..4].iter().all(u8::is_ascii_digit) && name.as_bytes()[4] == b'-'
}

/// Whether a file name takes part in sync.
pub fn is_syncable(name: &str) -> bool {
    if name.contains(".conflict-") || name.starts_with('.') {
        return false;
    }
    if name == "dictionary.txt" || name == "autocorrect.txt" || name == "todos.json" {
        return true;
    }
    is_session_name(name) && (name.ends_with(".jsonl") || name.ends_with(".md"))
}

/// Where a remote file name lives locally: session files under their year
/// folder, the rest at the profile root.
pub fn local_path_for(profile_dir: &Path, name: &str) -> PathBuf {
    if is_session_name(name) {
        profile_dir.join(&name[..4]).join(name)
    } else {
        profile_dir.join(name)
    }
}

/// Syncable files of a profile with their content hashes.
pub fn scan_local(profile_dir: &Path) -> Result<Vec<LocalFile>> {
    let mut files = Vec::new();
    if !profile_dir.is_dir() {
        return Ok(files);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(profile_dir).map_err(|e| Error::io(profile_dir, e))? {
        let path = entry.map_err(|e| Error::io(profile_dir, e))?.path();
        if path.is_dir() {
            for inner in fs::read_dir(&path).map_err(|e| Error::io(&path, e))? {
                candidates.push(inner.map_err(|e| Error::io(&path, e))?.path());
            }
        } else {
            candidates.push(path);
        }
    }
    for path in candidates {
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else { continue };
        if !path.is_file() || !is_syncable(&name) {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| Error::io(&path, e))?;
        files.push(LocalFile { md5: md5_hex(&bytes), name, path });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

fn conflict_name(name: &str, modified: &str) -> String {
    let stamp: String = modified.chars().filter(|c| c.is_ascii_alphanumeric()).take(15).collect();
    match name.rfind('.') {
        Some(dot) => format!("{}.conflict-{}{}", &name[..dot], stamp, &name[dot..]),
        None => format!("{name}.conflict-{stamp}"),
    }
}

/// One full sync round for a profile folder.
pub fn sync_profile(profile_dir: &Path, remote: &mut dyn Remote, state: &mut SyncState) -> Result<SyncReport> {
    let mut report = SyncReport::default();
    let local: BTreeMap<String, LocalFile> = scan_local(profile_dir)?.into_iter().map(|f| (f.name.clone(), f)).collect();

    // 1. What changed remotely.
    let changes = match &state.token {
        None => remote.list().map_err(Error::Other)?,
        Some(token) => remote.changes(token).map_err(Error::Other)?,
    };

    // 2. Pull.
    for rf in changes.files.iter().filter(|f| is_syncable(&f.name)) {
        let known = state.files.get(&rf.name).cloned();
        if known.as_ref().is_some_and(|k| k.remote_md5 == rf.md5) {
            continue; // remote unchanged since we last looked
        }
        match local.get(&rf.name) {
            Some(lf) if lf.md5 == rf.md5 => {
                // Same content on both sides: just remember it.
                state.files.insert(
                    rf.name.clone(),
                    FileState { remote_id: rf.id.clone(), remote_md5: rf.md5.clone(), synced_md5: rf.md5.clone() },
                );
                report.unchanged += 1;
            }
            Some(lf) if known.as_ref().map_or(true, |k| k.synced_md5 != lf.md5) => {
                // Changed on both sides (or never reconciled): keep both.
                let bytes = remote.download(&rf.id).map_err(Error::Other)?;
                let copy = conflict_name(&rf.name, &rf.modified);
                fsutil::atomic_write(&local_path_for(profile_dir, &copy), &bytes)?;
                let synced = known.map(|k| k.synced_md5).unwrap_or_default();
                state.files.insert(
                    rf.name.clone(),
                    FileState { remote_id: rf.id.clone(), remote_md5: rf.md5.clone(), synced_md5: synced },
                );
                report.conflicts.push(rf.name.clone());
            }
            _ => {
                // Missing here, or unchanged here since the last sync: take it.
                let bytes = remote.download(&rf.id).map_err(Error::Other)?;
                if md5_hex(&bytes) != rf.md5 {
                    return Err(Error::Other(format!("checksum mismatch downloading {}", rf.name)));
                }
                fsutil::atomic_write(&local_path_for(profile_dir, &rf.name), &bytes)?;
                state.files.insert(
                    rf.name.clone(),
                    FileState { remote_id: rf.id.clone(), remote_md5: rf.md5.clone(), synced_md5: rf.md5.clone() },
                );
                report.pulled.push(rf.name.clone());
            }
        }
    }
    state.token = Some(changes.token);

    // 3. Push what changed here (re-read, pulls may have altered the folder).
    for lf in scan_local(profile_dir)? {
        let known = state.files.get(&lf.name).cloned();
        if known.as_ref().is_some_and(|k| k.synced_md5 == lf.md5) {
            continue;
        }
        let bytes = fs::read(&lf.path).map_err(|e| Error::io(&lf.path, e))?;
        let uploaded = remote
            .upload(known.as_ref().map(|k| k.remote_id.as_str()), &lf.name, &bytes)
            .map_err(Error::Other)?;
        state.files.insert(
            lf.name.clone(),
            FileState { remote_id: uploaded.id, remote_md5: uploaded.md5, synced_md5: lf.md5.clone() },
        );
        report.pushed.push(lf.name);
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// In-memory remote with a change log.
    #[derive(Default)]
    struct FakeRemote {
        files: HashMap<String, (String, Vec<u8>, u64)>, // name -> (id, bytes, version)
        log: Vec<String>,                                 // names changed, in order
        next_id: u64,
        downloads: usize,
        uploads: usize,
    }

    impl FakeRemote {
        fn put(&mut self, name: &str, bytes: &[u8]) {
            let entry = self.files.entry(name.to_string()).or_insert_with(|| {
                self.next_id += 1;
                (format!("id{}", self.next_id), Vec::new(), 0)
            });
            entry.1 = bytes.to_vec();
            entry.2 += 1;
            self.log.push(name.to_string());
        }

        fn remote_file(&self, name: &str) -> RemoteFile {
            let (id, bytes, version) = &self.files[name];
            RemoteFile { id: id.clone(), name: name.to_string(), md5: md5_hex(bytes), modified: format!("2026-09-07T10:00:{version:02}Z") }
        }

        fn content(&self, name: &str) -> String {
            String::from_utf8(self.files[name].1.clone()).unwrap()
        }
    }

    impl Remote for FakeRemote {
        fn list(&mut self) -> std::result::Result<ChangeSet, String> {
            let mut names: Vec<&String> = self.files.keys().collect();
            names.sort();
            Ok(ChangeSet { files: names.iter().map(|n| self.remote_file(n)).collect(), token: self.log.len().to_string() })
        }

        fn changes(&mut self, token: &str) -> std::result::Result<ChangeSet, String> {
            let since: usize = token.parse().map_err(|_| "bad token".to_string())?;
            let mut names: Vec<String> = self.log[since..].to_vec();
            names.sort();
            names.dedup();
            Ok(ChangeSet { files: names.iter().map(|n| self.remote_file(n)).collect(), token: self.log.len().to_string() })
        }

        fn download(&mut self, id: &str) -> std::result::Result<Vec<u8>, String> {
            self.downloads += 1;
            self.files.values().find(|(i, _, _)| i == id).map(|(_, b, _)| b.clone()).ok_or_else(|| "not found".into())
        }

        fn upload(&mut self, existing_id: Option<&str>, name: &str, bytes: &[u8]) -> std::result::Result<RemoteFile, String> {
            self.uploads += 1;
            if let Some(id) = existing_id {
                assert_eq!(self.files[name].0, id, "update must target the known id");
            }
            self.put(name, bytes);
            Ok(self.remote_file(name))
        }
    }

    fn write(dir: &Path, name: &str, content: &str) {
        fsutil::atomic_write(&local_path_for(dir, name), content.as_bytes()).unwrap();
    }

    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(local_path_for(dir, name)).unwrap()
    }

    #[test]
    fn syncable_names_and_local_paths() {
        assert!(is_syncable("2026-09-07T093105_ABC123.jsonl"));
        assert!(is_syncable("2026-09-07T093105_ABC123.md"));
        assert!(is_syncable("dictionary.txt"));
        assert!(is_syncable("autocorrect.txt"));
        assert!(is_syncable("todos.json"));
        assert!(!is_syncable("2026-09-07T093105_ABC123.conflict-20260907T1000.jsonl"));
        assert!(!is_syncable(".2026-09-07T093105_ABC123.jsonl.1234.tmp"));
        assert!(!is_syncable("notes.txt"));
        assert!(!is_syncable("index.sqlite"));
        let dir = Path::new("/data/work");
        assert_eq!(local_path_for(dir, "2026-09-07T093105_ABC123.jsonl"), Path::new("/data/work/2026/2026-09-07T093105_ABC123.jsonl"));
        assert_eq!(local_path_for(dir, "dictionary.txt"), Path::new("/data/work/dictionary.txt"));
        assert_eq!(conflict_name("2026-09-07T093105_ABC123.jsonl", "2026-09-07T10:00:03Z"), "2026-09-07T093105_ABC123.conflict-20260907T100003.jsonl");
    }

    #[test]
    fn first_sync_pushes_local_and_pulls_remote_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("work");
        write(&dir, "2026-09-01T090000_AAAAAA.jsonl", "local session\n");
        write(&dir, "dictionary.txt", "Xoán\n");
        write(&dir, "notes.txt", "not synced");
        let mut remote = FakeRemote::default();
        remote.put("2026-09-05T090000_BBBBBB.jsonl", b"remote session\n");
        remote.put("2026-09-05T090000_BBBBBB.md", b"# remote\n");
        let mut state = SyncState::default();

        let report = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(report.pulled, vec!["2026-09-05T090000_BBBBBB.jsonl", "2026-09-05T090000_BBBBBB.md"]);
        assert_eq!(report.pushed, vec!["2026-09-01T090000_AAAAAA.jsonl", "dictionary.txt"]);
        assert!(report.conflicts.is_empty());
        assert!(report.sessions_changed());
        assert_eq!(read(&dir, "2026-09-05T090000_BBBBBB.jsonl"), "remote session\n");
        assert_eq!(remote.content("dictionary.txt"), "Xoán\n");
        assert!(!remote.files.contains_key("notes.txt"));
        assert_eq!(state.files.len(), 4);
        assert!(state.token.is_some());

        // A second round with nothing changed transfers nothing.
        let (d, u) = (remote.downloads, remote.uploads);
        let again = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(again, SyncReport::default());
        assert_eq!((remote.downloads, remote.uploads), (d, u));
    }

    #[test]
    fn local_changes_are_pushed_and_remote_changes_pulled_incrementally() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("work");
        write(&dir, "2026-09-01T090000_AAAAAA.jsonl", "v1\n");
        let mut remote = FakeRemote::default();
        let mut state = SyncState::default();
        sync_profile(&dir, &mut remote, &mut state).unwrap();

        write(&dir, "2026-09-01T090000_AAAAAA.jsonl", "v2 local\n");
        let report = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(report.pushed, vec!["2026-09-01T090000_AAAAAA.jsonl"]);
        assert_eq!(remote.content("2026-09-01T090000_AAAAAA.jsonl"), "v2 local\n");

        remote.put("2026-09-01T090000_AAAAAA.jsonl", b"v3 remote\n");
        remote.put("autocorrect.txt", b"tbd=to be defined\n");
        let report = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(report.pulled, vec!["2026-09-01T090000_AAAAAA.jsonl", "autocorrect.txt"]);
        assert!(report.pushed.is_empty());
        assert_eq!(read(&dir, "2026-09-01T090000_AAAAAA.jsonl"), "v3 remote\n");
        assert_eq!(read(&dir, "autocorrect.txt"), "tbd=to be defined\n");
    }

    #[test]
    fn changes_on_both_sides_keep_both_versions() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("work");
        let name = "2026-09-01T090000_AAAAAA.jsonl";
        write(&dir, name, "base\n");
        let mut remote = FakeRemote::default();
        let mut state = SyncState::default();
        sync_profile(&dir, &mut remote, &mut state).unwrap();

        write(&dir, name, "mine\n");
        remote.put(name, b"theirs\n");
        let report = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(report.conflicts, vec![name]);
        assert_eq!(report.pushed, vec![name], "the local version wins and is pushed");
        assert_eq!(read(&dir, name), "mine\n");
        assert_eq!(remote.content(name), "mine\n");
        let copies: Vec<String> = scan_dir(&dir.join("2026")).into_iter().filter(|n| n.contains(".conflict-")).collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(fs::read_to_string(dir.join("2026").join(&copies[0])).unwrap(), "theirs\n");

        // Conflict copies stay local and the next round is quiet.
        let again = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(again, SyncReport::default());
        assert!(!remote.files.keys().any(|k| k.contains(".conflict-")));
    }

    #[test]
    fn a_second_machine_with_an_unreconciled_copy_gets_a_conflict_copy_not_data_loss() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("work");
        let name = "2026-09-01T090000_AAAAAA.jsonl";
        write(&dir, name, "old copy from a backup\n");
        let mut remote = FakeRemote::default();
        remote.put(name, b"current\n");
        let mut state = SyncState::default();
        let report = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(report.conflicts, vec![name]);
        assert_eq!(read(&dir, name), "old copy from a backup\n");
        assert_eq!(remote.content(name), "old copy from a backup\n");
        let copies: Vec<String> = scan_dir(&dir.join("2026")).into_iter().filter(|n| n.contains(".conflict-")).collect();
        assert_eq!(fs::read_to_string(dir.join("2026").join(&copies[0])).unwrap(), "current\n");
    }

    #[test]
    fn identical_content_on_both_sides_is_reconciled_without_transfer() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("work");
        write(&dir, "dictionary.txt", "same\n");
        let mut remote = FakeRemote::default();
        remote.put("dictionary.txt", b"same\n");
        let mut state = SyncState::default();
        let report = sync_profile(&dir, &mut remote, &mut state).unwrap();
        assert_eq!(report.unchanged, 1);
        assert!(report.pulled.is_empty() && report.pushed.is_empty());
        assert_eq!(remote.downloads + remote.uploads, 0);
    }

    #[test]
    fn state_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("cache").join("sync").join("work.json");
        assert_eq!(SyncState::load(&path), SyncState::default());
        let mut state = SyncState { token: Some("42".into()), ..Default::default() };
        state.files.insert("a.jsonl".into(), FileState { remote_id: "id1".into(), remote_md5: "m".into(), synced_md5: "m".into() });
        state.folders.insert("root".into(), "f1".into());
        state.save(&path).unwrap();
        assert_eq!(SyncState::load(&path), state);
    }

    fn scan_dir(dir: &Path) -> Vec<String> {
        fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect()
    }
}
