//! Data model. A session file is a sequence of `Record`s, one JSON object per
//! line; `Session` is the in-memory view of one file.

use serde::{Deserialize, Serialize};

use crate::time::{file_stamp, serde_ts, serde_ts_opt, Timestamp};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionHeader {
    pub id: String,
    pub profile: String,
    #[serde(with = "serde_ts")]
    pub started: Timestamp,
    /// IANA timezone name of the machine that started the session.
    pub tz: String,
    #[serde(default)]
    pub title: Option<String>,
    /// Application and version that created the file, e.g. `todolisto/0.1.0`.
    #[serde(default)]
    pub app: String,
    /// Name of the machine that owns the session while it is open.
    #[serde(default)]
    pub device: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    #[serde(with = "serde_ts")]
    pub ts: Timestamp,
    /// Entry text; lines are separated by `\n`.
    pub text: String,
    /// Lower-cased `#tags` found in the text, in order of appearance.
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, with = "serde_ts_opt", skip_serializing_if = "Option::is_none")]
    pub edited: Option<Timestamp>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    #[default]
    Manual,
    Inactivity,
    TakenOver,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEnd {
    #[serde(with = "serde_ts")]
    pub ended: Timestamp,
    pub entries: usize,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub reason: EndReason,
}

/// Something that was done with the session after it closed (an agent result,
/// an exported item...). Free-form `data` keeps the format open for later
/// executors without a schema change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(with = "serde_ts")]
    pub at: Timestamp,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Record {
    Session(SessionHeader),
    Entry(Entry),
    SessionEnd(SessionEnd),
    Action(Action),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub header: SessionHeader,
    #[serde(default)]
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub end: Option<SessionEnd>,
    #[serde(default)]
    pub actions: Vec<Action>,
}

/// What the UI needs to list a session without loading its entries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: String,
    pub profile: String,
    #[serde(with = "serde_ts")]
    pub started: Timestamp,
    #[serde(default, with = "serde_ts_opt")]
    pub ended: Option<Timestamp>,
    pub title: Option<String>,
    pub entries: usize,
    pub todos: usize,
    pub first_line: Option<String>,
    pub open: bool,
    pub reason: Option<EndReason>,
    pub device: Option<String>,
}

impl Session {
    pub fn new(header: SessionHeader) -> Session {
        Session { header, entries: Vec::new(), end: None, actions: Vec::new() }
    }

    pub fn id(&self) -> &str {
        &self.header.id
    }

    pub fn is_open(&self) -> bool {
        self.end.is_none()
    }

    /// Title from the end record, else from the header.
    pub fn title(&self) -> Option<&str> {
        self.end
            .as_ref()
            .and_then(|e| e.title.as_deref())
            .or(self.header.title.as_deref())
    }

    /// Time of the last write to the session: the newest entry timestamp or
    /// edit, or the start time when there are no entries.
    pub fn last_activity(&self) -> Timestamp {
        let mut last = self.header.started;
        for e in &self.entries {
            if e.ts > last {
                last = e.ts;
            }
            if let Some(edited) = e.edited {
                if edited > last {
                    last = edited;
                }
            }
        }
        last
    }

    pub fn file_stem(&self) -> String {
        file_stem(&self.header.started, &self.header.id)
    }

    pub fn to_records(&self) -> Vec<Record> {
        let mut records = Vec::with_capacity(self.entries.len() + 2 + self.actions.len());
        records.push(Record::Session(self.header.clone()));
        records.extend(self.entries.iter().cloned().map(Record::Entry));
        if let Some(end) = &self.end {
            records.push(Record::SessionEnd(end.clone()));
        }
        records.extend(self.actions.iter().cloned().map(Record::Action));
        records
    }

    /// Builds a session from records. The first record must be the header;
    /// entries keep file order; a second end record replaces the first.
    pub fn from_records(records: Vec<Record>) -> Result<Session, String> {
        let mut iter = records.into_iter();
        let header = match iter.next() {
            Some(Record::Session(h)) => h,
            Some(other) => return Err(format!("first record must be the session header, found {}", record_kind(&other))),
            None => return Err("empty session file".to_string()),
        };
        let mut session = Session::new(header);
        for record in iter {
            match record {
                Record::Session(_) => return Err("duplicate session header".to_string()),
                Record::Entry(e) => session.entries.push(e),
                Record::SessionEnd(end) => session.end = Some(end),
                Record::Action(a) => session.actions.push(a),
            }
        }
        Ok(session)
    }

    pub fn summary(&self) -> SessionSummary {
        SessionSummary {
            id: self.header.id.clone(),
            profile: self.header.profile.clone(),
            started: self.header.started,
            ended: self.end.as_ref().map(|e| e.ended),
            title: self.title().map(str::to_string),
            entries: self.entries.len(),
            todos: self.entries.iter().filter(|e| e.tags.iter().any(|t| t == "todo")).count(),
            first_line: self.entries.first().map(|e| first_line(&e.text)),
            open: self.is_open(),
            reason: self.end.as_ref().map(|e| e.reason),
            device: self.header.device.clone(),
        }
    }
}

pub fn record_kind(record: &Record) -> &'static str {
    match record {
        Record::Session(_) => "session",
        Record::Entry(_) => "entry",
        Record::SessionEnd(_) => "session_end",
        Record::Action(_) => "action",
    }
}

/// File stem for a session: the start time plus the last six characters of the
/// id, e.g. `2026-09-07T093105_8Q3F2A`. Stable for the life of the session.
pub fn file_stem(started: &Timestamp, id: &str) -> String {
    let suffix: String = id.chars().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{}_{}", file_stamp(started), suffix)
}

pub fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    const MAX: usize = 100;
    if line.chars().count() > MAX {
        let cut: String = line.chars().take(MAX).collect();
        format!("{}…", cut.trim_end())
    } else {
        line.to_string()
    }
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | ':' | '/' | '.')
}

/// Extracts `#tags` from free text: lower-cased, de-duplicated, in order of
/// appearance. A tag starts with `#` preceded by nothing or a non-tag
/// character, its first character is a letter, and trailing punctuation is
/// dropped (`#todo.` gives `todo`). URLs with fragments are not tags.
pub fn extract_tags(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut tags: Vec<String> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let starts_tag = chars[i] == '#'
            && (i == 0 || !is_tag_char(chars[i - 1]))
            && i + 1 < chars.len()
            && chars[i + 1].is_alphabetic();
        if !starts_tag {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < chars.len() && is_tag_char(chars[j]) {
            j += 1;
        }
        let mut end = j;
        while end > i + 1 && matches!(chars[end - 1], '.' | ':' | '-' | '/') {
            end -= 1;
        }
        let tag: String = chars[i + 1..end].iter().collect::<String>().to_lowercase();
        if !tag.is_empty() && !tags.contains(&tag) {
            tags.push(tag);
        }
        i = j;
    }
    tags
}

/// Cleans an entry coming from the editor: normalises line endings, trims
/// trailing blank lines and recomputes the tags from the text.
pub fn normalize_entry(mut entry: Entry) -> Entry {
    let text = entry.text.replace("\r\n", "\n").replace('\r', "\n");
    entry.text = text.trim_end_matches(['\n', ' ', '\t']).to_string();
    entry.tags = extract_tags(&entry.text);
    entry
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::parse;

    fn ts(s: &str) -> Timestamp {
        parse(s).unwrap()
    }

    #[test]
    fn tags_are_extracted_in_order_and_lowercased() {
        assert_eq!(extract_tags("#TODO ask Maria #q about #todo"), vec!["todo", "q"]);
        assert_eq!(extract_tags("see #repo:owner/name."), vec!["repo:owner/name"]);
        assert_eq!(extract_tags("http://x.y/z#frag and a#b"), Vec::<String>::new());
        assert_eq!(extract_tags("#1 issue ## nothing"), Vec::<String>::new());
        assert_eq!(extract_tags("(#idea) #dec-1!"), vec!["idea", "dec-1"]);
        assert_eq!(extract_tags("#España #galego"), vec!["españa", "galego"]);
    }

    #[test]
    fn records_round_trip_through_jsonl() {
        let header = SessionHeader {
            id: "01J9Z6K3A0Q5H7R8C4T6M1W2XY".into(),
            profile: "work".into(),
            started: ts("2026-09-07T09:31:05.123+02:00"),
            tz: "Europe/Madrid".into(),
            title: None,
            app: "todolisto/0.1.0".into(),
            device: Some("laptop".into()),
        };
        let mut session = Session::new(header);
        session.entries.push(normalize_entry(Entry {
            id: "01J9Z6K4A0Q5H7R8C4T6M1W2XZ".into(),
            ts: ts("2026-09-07T09:32:40.502+02:00"),
            text: "#todo Ask Maria\nsecond line\n".into(),
            tags: vec![],
            edited: None,
        }));
        session.end = Some(SessionEnd {
            ended: ts("2026-09-07T10:45:12+02:00"),
            entries: 1,
            title: Some("Kickoff".into()),
            reason: EndReason::Inactivity,
        });

        let lines: Vec<String> = session
            .to_records()
            .iter()
            .map(|r| serde_json::to_string(r).unwrap())
            .collect();
        assert!(lines[0].starts_with("{\"kind\":\"session\""));
        assert!(lines[1].contains("\"tags\":[\"todo\"]"));
        assert!(lines[1].contains("\"text\":\"#todo Ask Maria\\nsecond line\""));
        assert!(!lines[1].contains("edited"));
        assert!(lines[2].contains("\"kind\":\"session_end\""));
        assert!(lines[2].contains("\"reason\":\"inactivity\""));

        let records: Vec<Record> = lines.iter().map(|l| serde_json::from_str(l).unwrap()).collect();
        let back = Session::from_records(records).unwrap();
        assert_eq!(back, session);
        assert_eq!(back.file_stem(), "2026-09-07T093105_M1W2XY");
        assert_eq!(back.summary().todos, 1);
        assert_eq!(back.summary().first_line.as_deref(), Some("#todo Ask Maria"));
        assert_eq!(back.title(), Some("Kickoff"));
    }

    #[test]
    fn last_activity_considers_edits() {
        let header = SessionHeader {
            id: "A".into(),
            profile: "work".into(),
            started: ts("2026-09-07T09:00:00+02:00"),
            tz: "UTC".into(),
            title: None,
            app: String::new(),
            device: None,
        };
        let mut s = Session::new(header);
        assert_eq!(s.last_activity(), ts("2026-09-07T09:00:00+02:00"));
        s.entries.push(Entry {
            id: "B".into(),
            ts: ts("2026-09-07T09:10:00+02:00"),
            text: "x".into(),
            tags: vec![],
            edited: Some(ts("2026-09-07T09:50:00+02:00")),
        });
        s.entries.push(Entry {
            id: "C".into(),
            ts: ts("2026-09-07T09:20:00+02:00"),
            text: "y".into(),
            tags: vec![],
            edited: None,
        });
        assert_eq!(s.last_activity(), ts("2026-09-07T09:50:00+02:00"));
    }
}
