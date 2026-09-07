//! The JSONL store: one file per session under
//! `<root>/data/<profile>/<year>/<stem>.jsonl`, plus a rendered `.md` copy for
//! closed sessions. Files are rewritten atomically while a session is open and
//! never rewritten after it closes (only appended to), which keeps sync simple.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Datelike, Duration};

use crate::error::{Error, Result};
use crate::fsutil;
use crate::markdown;
use crate::model::{normalize_entry, EndReason, Entry, Record, Session, SessionEnd, SessionHeader, SessionSummary};
use crate::time::Timestamp;

pub struct Store {
    root: PathBuf,
}

/// Parameters for a new session; the caller decides the clock and the
/// identity of the machine.
pub struct NewSession {
    pub profile: String,
    pub started: Timestamp,
    pub tz: String,
    pub app: String,
    pub device: Option<String>,
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Store {
        Store { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn data_dir(&self) -> PathBuf {
        self.root.join("data")
    }

    pub fn profile_dir(&self, profile: &str) -> PathBuf {
        self.data_dir().join(profile)
    }

    pub fn session_path(&self, session: &Session) -> PathBuf {
        self.profile_dir(&session.header.profile)
            .join(session.header.started.year().to_string())
            .join(format!("{}.jsonl", session.file_stem()))
    }

    pub fn markdown_path(&self, session: &Session) -> PathBuf {
        self.session_path(session).with_extension("md")
    }

    /// All session files of a profile, sorted by file name (= by start time).
    fn session_files(&self, profile: &str) -> Result<Vec<PathBuf>> {
        let dir = self.profile_dir(profile);
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut files = Vec::new();
        for year in fs::read_dir(&dir).map_err(|e| Error::io(&dir, e))? {
            let year = year.map_err(|e| Error::io(&dir, e))?;
            let year_path = year.path();
            if !year_path.is_dir() {
                continue;
            }
            for entry in fs::read_dir(&year_path).map_err(|e| Error::io(&year_path, e))? {
                let path = entry.map_err(|e| Error::io(&year_path, e))?.path();
                let is_jsonl = path.extension().and_then(|e| e.to_str()) == Some("jsonl");
                let is_hidden = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with('.'))
                    .unwrap_or(true);
                if is_jsonl && !is_hidden {
                    files.push(path);
                }
            }
        }
        files.sort();
        Ok(files)
    }

    /// Every session of a profile, parsed, oldest first.
    pub fn load_sessions(&self, profile: &str) -> Result<Vec<Session>> {
        let mut sessions = Vec::new();
        for path in self.session_files(profile)? {
            sessions.push(parse_file(&path)?);
        }
        sessions.sort_by_key(|s| s.header.started);
        Ok(sessions)
    }

    pub fn list_sessions(&self, profile: &str) -> Result<Vec<SessionSummary>> {
        let mut summaries = Vec::new();
        for path in self.session_files(profile)? {
            summaries.push(parse_file(&path)?.summary());
        }
        summaries.sort_by_key(|s| s.started);
        Ok(summaries)
    }

    fn find_session_file(&self, profile: &str, id: &str) -> Result<Option<PathBuf>> {
        let suffix: String = id.chars().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
        let wanted = format!("_{suffix}");
        for path in self.session_files(profile)? {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if stem.ends_with(&wanted) && parse_file(&path)?.header.id == id {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    pub fn read_session(&self, profile: &str, id: &str) -> Result<Session> {
        match self.find_session_file(profile, id)? {
            Some(path) => parse_file(&path),
            None => Err(Error::SessionNotFound(id.to_string())),
        }
    }

    /// The newest session of the profile that has no end record.
    pub fn open_session(&self, profile: &str) -> Result<Option<Session>> {
        let mut open: Option<Session> = None;
        for path in self.session_files(profile)? {
            let session = parse_file(&path)?;
            if session.is_open() && open.as_ref().map(|o| session.header.started > o.header.started).unwrap_or(true) {
                open = Some(session);
            }
        }
        Ok(open)
    }

    pub fn create_session(&self, new: NewSession) -> Result<Session> {
        let header = SessionHeader {
            id: ulid::Ulid::new().to_string(),
            profile: new.profile,
            started: new.started,
            tz: new.tz,
            title: None,
            app: new.app,
            device: new.device,
        };
        let session = Session::new(header);
        self.write_session(&session)?;
        Ok(session)
    }

    /// Replaces the entries of an open session with what the editor holds.
    pub fn save_entries(&self, profile: &str, id: &str, entries: Vec<Entry>) -> Result<Session> {
        let mut session = self.read_session(profile, id)?;
        if !session.is_open() {
            return Err(Error::SessionClosed(id.to_string()));
        }
        session.entries = entries
            .into_iter()
            .map(normalize_entry)
            .filter(|e| !e.text.trim().is_empty())
            .collect();
        self.write_session(&session)?;
        Ok(session)
    }

    /// Closes a session. A session without entries is deleted instead and
    /// `None` is returned.
    pub fn end_session(&self, profile: &str, id: &str, ended: Timestamp, reason: EndReason) -> Result<Option<Session>> {
        let mut session = self.read_session(profile, id)?;
        if !session.is_open() {
            return Err(Error::SessionClosed(id.to_string()));
        }
        if session.entries.is_empty() {
            fsutil::remove_file_if_exists(&self.session_path(&session))?;
            return Ok(None);
        }
        let ended = if ended < session.last_activity() { session.last_activity() } else { ended };
        session.end = Some(SessionEnd {
            ended,
            entries: session.entries.len(),
            title: session.header.title.clone(),
            reason,
        });
        self.write_session(&session)?;
        fsutil::atomic_write(&self.markdown_path(&session), markdown::render(&session).as_bytes())?;
        Ok(Some(session))
    }

    /// Reopens a closed session so that entries can be added to it. Refused
    /// while another session with entries is open; an empty open session is
    /// discarded.
    pub fn reopen_session(&self, profile: &str, id: &str) -> Result<Session> {
        let mut session = self.read_session(profile, id)?;
        if session.is_open() {
            return Err(Error::SessionOpen(id.to_string()));
        }
        if let Some(open) = self.open_session(profile)? {
            if open.entries.is_empty() {
                fsutil::remove_file_if_exists(&self.session_path(&open))?;
            } else {
                return Err(Error::AnotherSessionOpen);
            }
        }
        session.end = None;
        self.write_session(&session)?;
        fsutil::remove_file_if_exists(&self.markdown_path(&session))?;
        Ok(session)
    }

    /// Closes the open session of a profile when nothing was written to it for
    /// `inactivity_minutes`. The end time is the last activity, not `now`.
    /// Returns the closed session, if any. `0` minutes disables the rule.
    pub fn auto_close_if_inactive(&self, profile: &str, now: Timestamp, inactivity_minutes: u32) -> Result<Option<Session>> {
        if inactivity_minutes == 0 {
            return Ok(None);
        }
        let Some(open) = self.open_session(profile)? else {
            return Ok(None);
        };
        let last = open.last_activity();
        if last + Duration::minutes(i64::from(inactivity_minutes)) > now {
            return Ok(None);
        }
        self.end_session(profile, &open.header.id, last, EndReason::Inactivity)
    }

    fn dictionary_path(&self, profile: &str) -> PathBuf {
        self.profile_dir(profile).join("dictionary.txt")
    }

    /// Words the user added to the dictionary of a profile, one per line in
    /// `data/<profile>/dictionary.txt`.
    pub fn user_words(&self, profile: &str) -> Result<Vec<String>> {
        let path = self.dictionary_path(profile);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = fsutil::read_to_string(&path)?;
        let mut words: Vec<String> = Vec::new();
        for line in raw.lines() {
            let word = line.trim();
            if word.is_empty() || word.starts_with('#') || words.iter().any(|w| w == word) {
                continue;
            }
            words.push(word.to_string());
        }
        Ok(words)
    }

    pub fn add_user_word(&self, profile: &str, word: &str) -> Result<Vec<String>> {
        let word = word.trim();
        if word.is_empty() || word.chars().any(char::is_whitespace) {
            return Err(Error::Other("a dictionary word cannot be empty or contain spaces".to_string()));
        }
        let mut words = self.user_words(profile)?;
        if !words.iter().any(|w| w == word) {
            words.push(word.to_string());
            let mut content = words.join("\n");
            content.push('\n');
            fsutil::atomic_write(&self.dictionary_path(profile), content.as_bytes())?;
        }
        Ok(words)
    }

    /// Personal autocorrect rules from `data/<profile>/autocorrect.txt`, one
    /// `wrong=right` pair per line; `#` starts a comment.
    pub fn autocorrect_rules(&self, profile: &str) -> Result<BTreeMap<String, String>> {
        let path = self.profile_dir(profile).join("autocorrect.txt");
        let mut rules = BTreeMap::new();
        if !path.exists() {
            return Ok(rules);
        }
        let raw = fsutil::read_to_string(&path)?;
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((wrong, right)) = line.split_once('=') {
                let (wrong, right) = (wrong.trim(), right.trim());
                if !wrong.is_empty() && !right.is_empty() && !wrong.chars().any(char::is_whitespace) {
                    rules.insert(wrong.to_lowercase(), right.to_string());
                }
            }
        }
        Ok(rules)
    }

    pub fn write_session(&self, session: &Session) -> Result<PathBuf> {
        let path = self.session_path(session);
        let mut buf = String::new();
        for record in session.to_records() {
            let line = serde_json::to_string(&record).map_err(|e| Error::Other(e.to_string()))?;
            buf.push_str(&line);
            buf.push('\n');
        }
        fsutil::atomic_write(&path, buf.as_bytes())?;
        Ok(path)
    }
}

/// Parses a session file. Lines whose `kind` is unknown are skipped so that
/// files written by a newer version still load.
pub fn parse_file(path: &Path) -> Result<Session> {
    let raw = fsutil::read_to_string(path)?;
    let mut records = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(line).map_err(|e| Error::Parse {
            path: path.to_path_buf(),
            line: index + 1,
            message: e.to_string(),
        })?;
        let kind = value.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        if !matches!(kind, "session" | "entry" | "session_end" | "action") {
            continue;
        }
        let record: Record = serde_json::from_value(value).map_err(|e| Error::Parse {
            path: path.to_path_buf(),
            line: index + 1,
            message: e.to_string(),
        })?;
        records.push(record);
    }
    Session::from_records(records).map_err(|message| Error::Parse { path: path.to_path_buf(), line: 0, message })
}
