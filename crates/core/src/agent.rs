//! The session agent: what it proposes after a session ends, the deterministic
//! fallback based on `#tags`, how a proposal is applied to a session, and the
//! digest of to-dos and facts across sessions.
//!
//! The model call itself lives in the shell (it needs the network); this
//! module owns the prompt, the JSON schema and everything that can be tested
//! without an API key.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::fsutil;
use crate::markdown;
use crate::model::{Action, Session};
use crate::store::Store;
use crate::time::{format as format_ts, serde_ts, Timestamp};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Item {
    pub text: String,
    /// Entry the item comes from, when known.
    #[serde(default)]
    pub entry_id: Option<String>,
    /// `YYYY-MM-DD` when the notes name a date.
    #[serde(default)]
    pub due: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Proposal {
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub todos: Vec<Item>,
    #[serde(default)]
    pub facts: Vec<Item>,
    #[serde(default)]
    pub questions: Vec<Item>,
    #[serde(default)]
    pub decisions: Vec<Item>,
    #[serde(default)]
    pub ideas: Vec<Item>,
    /// `tags` (deterministic) or `claude:<model>`.
    #[serde(default)]
    pub source: String,
}

impl Proposal {
    pub fn is_empty(&self) -> bool {
        self.todos.is_empty() && self.facts.is_empty() && self.questions.is_empty() && self.decisions.is_empty() && self.ideas.is_empty()
    }
}

/// What the user kept in the review panel: indexes into the proposal lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Selection {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: bool,
    #[serde(default)]
    pub todos: Vec<usize>,
    #[serde(default)]
    pub facts: Vec<usize>,
    #[serde(default)]
    pub questions: Vec<usize>,
    #[serde(default)]
    pub decisions: Vec<usize>,
    #[serde(default)]
    pub ideas: Vec<usize>,
}

pub const ACTION_KIND: &str = "agent";

/// JSON schema of the model's answer (structured output).
pub fn schema() -> serde_json::Value {
    let item = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "entry_id", "due"],
        "properties": {
            "text": { "type": "string", "description": "The item, one sentence, in the language of the notes" },
            "entry_id": { "type": ["string", "null"], "description": "id of the entry the item comes from" },
            "due": { "type": ["string", "null"], "description": "YYYY-MM-DD when the notes name a date, else null" }
        }
    });
    serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "summary", "todos", "facts", "questions", "decisions", "ideas"],
        "properties": {
            "title": { "type": "string", "description": "Short title for the session, at most eight words" },
            "summary": { "type": "string", "description": "Two or three sentences" },
            "todos": { "type": "array", "items": item },
            "facts": { "type": "array", "items": item },
            "questions": { "type": "array", "items": item },
            "decisions": { "type": "array", "items": item },
            "ideas": { "type": "array", "items": item }
        }
    })
}

pub fn system_prompt() -> String {
    "You turn the raw, timestamped notes of one work session (a meeting, a brainstorm, a study block) into \
things the writer can act on. The notes may mix English, Spanish and Galician; answer in the language that \
dominates them. Only use what the notes say: never invent tasks, dates, names or numbers.\n\
\n\
Categories:\n\
- todos: things the writer (or someone they can chase) has to do. Entries tagged #todo are always todos. \
Infer a todo from untagged text only when it is clearly an action to take.\n\
- facts: data worth remembering later (numbers, names, decisions of others, references). #data and #fact entries belong here.\n\
- questions: open questions and unknowns; #q entries belong here.\n\
- decisions: decisions taken; #decision entries belong here.\n\
- ideas: ideas to explore; #idea entries belong here.\n\
\n\
Keep each item to one sentence, remove the tags from the text, keep the entry id it comes from, and set due \
only when the notes name a date. The title is at most eight words. The summary is two or three sentences \
about what the session was about and what came out of it."
        .to_string()
}

/// The user message: profile context plus the session as compact JSON.
pub fn user_message(session: &Session, profile_name: &str) -> String {
    let entries: Vec<serde_json::Value> = session
        .entries
        .iter()
        .map(|e| serde_json::json!({ "id": e.id, "ts": format_ts(&e.ts), "text": e.text, "tags": e.tags }))
        .collect();
    let payload = serde_json::json!({
        "profile": profile_name,
        "started": format_ts(&session.header.started),
        "ended": session.end.as_ref().map(|e| format_ts(&e.ended)),
        "entries": entries,
    });
    format!("Session notes as JSON:\n{}", serde_json::to_string_pretty(&payload).unwrap_or_default())
}

fn category_of(tag: &str) -> Option<&'static str> {
    match tag {
        "todo" | "todos" | "tarefa" | "tarea" => Some("todos"),
        "data" | "fact" | "facts" | "dato" | "datos" => Some("facts"),
        "q" | "question" | "pregunta" | "dubida" | "dúbida" | "duda" => Some("questions"),
        "decision" | "decisión" | "decisions" => Some("decisions"),
        "idea" | "ideas" => Some("ideas"),
        _ => None,
    }
}

/// The entry text without its `#tags`, whitespace tidied.
pub fn strip_tags(text: &str) -> String {
    text.split_whitespace()
        .filter(|w| !(w.starts_with('#') && w.len() > 1 && w.chars().nth(1).is_some_and(char::is_alphabetic)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_line(text: &str) -> String {
    let line = strip_tags(text.lines().next().unwrap_or(""));
    if line.chars().count() > 80 {
        format!("{}…", line.chars().take(79).collect::<String>().trim_end())
    } else {
        line
    }
}

/// What can be proposed without a model: tagged entries sorted into their
/// categories, and the first line as the title.
pub fn from_tags(session: &Session) -> Proposal {
    let mut proposal = Proposal { source: "tags".into(), ..Default::default() };
    proposal.title = session.entries.first().map(|e| first_line(&e.text)).unwrap_or_default();
    for entry in &session.entries {
        let mut categories: Vec<&'static str> = Vec::new();
        for tag in &entry.tags {
            if let Some(category) = category_of(tag) {
                if !categories.contains(&category) {
                    categories.push(category);
                }
            }
        }
        if categories.is_empty() {
            continue;
        }
        let item = Item { text: strip_tags(&entry.text), entry_id: Some(entry.id.clone()), due: None };
        for category in categories {
            let list = match category {
                "todos" => &mut proposal.todos,
                "facts" => &mut proposal.facts,
                "questions" => &mut proposal.questions,
                "decisions" => &mut proposal.decisions,
                _ => &mut proposal.ideas,
            };
            list.push(item.clone());
        }
    }
    proposal
}

fn merge_list(target: &mut Vec<Item>, tagged: &[Item]) {
    for item in tagged {
        let known = target.iter().any(|t| t.entry_id.is_some() && t.entry_id == item.entry_id);
        if !known {
            target.push(item.clone());
        }
    }
}

/// A model proposal completed with every tagged entry it may have skipped.
pub fn merge(mut proposal: Proposal, tagged: &Proposal) -> Proposal {
    merge_list(&mut proposal.todos, &tagged.todos);
    merge_list(&mut proposal.facts, &tagged.facts);
    merge_list(&mut proposal.questions, &tagged.questions);
    merge_list(&mut proposal.decisions, &tagged.decisions);
    merge_list(&mut proposal.ideas, &tagged.ideas);
    if proposal.title.trim().is_empty() {
        proposal.title = tagged.title.clone();
    }
    proposal
}

pub fn parse_response(json: &str) -> std::result::Result<Proposal, String> {
    serde_json::from_str::<Proposal>(json).map_err(|e| format!("the model answer is not the expected JSON: {e}"))
}

fn pick(list: &[Item], indexes: &[usize]) -> Vec<Item> {
    indexes.iter().filter_map(|i| list.get(*i).cloned()).collect()
}

/// Writes the kept items into the session: the title, and an `agent` action
/// record with the selected items. Returns the updated session.
pub fn apply(store: &Store, profile: &str, session_id: &str, proposal: &Proposal, selection: &Selection, now: Timestamp) -> Result<Session> {
    let mut session = store.read_session(profile, session_id)?;
    if let Some(title) = selection.title.as_ref().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        session.header.title = Some(title.to_string());
        if let Some(end) = session.end.as_mut() {
            end.title = Some(title.to_string());
        }
    }
    let data = serde_json::json!({
        "source": proposal.source,
        "summary": if selection.summary { Some(proposal.summary.clone()) } else { None },
        "todos": pick(&proposal.todos, &selection.todos),
        "facts": pick(&proposal.facts, &selection.facts),
        "questions": pick(&proposal.questions, &selection.questions),
        "decisions": pick(&proposal.decisions, &selection.decisions),
        "ideas": pick(&proposal.ideas, &selection.ideas),
    });
    session.actions.push(Action { kind: ACTION_KIND.into(), entry: None, at: now, data });
    store.write_session(&session)?;
    if !session.is_open() {
        fsutil::atomic_write(&store.markdown_path(&session), markdown::render(&session).as_bytes())?;
    }
    Ok(session)
}

/// The agent's items stored in a session (the newest `agent` action).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Applied {
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub todos: Vec<Item>,
    #[serde(default)]
    pub facts: Vec<Item>,
    #[serde(default)]
    pub questions: Vec<Item>,
    #[serde(default)]
    pub decisions: Vec<Item>,
    #[serde(default)]
    pub ideas: Vec<Item>,
}

pub fn applied(session: &Session) -> Option<Applied> {
    session
        .actions
        .iter()
        .rev()
        .find(|a| a.kind == ACTION_KIND)
        .and_then(|a| serde_json::from_value(a.data.clone()).ok())
}

/// Done state of to-dos, `data/<profile>/todos.json` (synced).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TodoState {
    #[serde(default)]
    pub done: BTreeMap<String, String>,
}

impl TodoState {
    pub fn load(path: &Path) -> TodoState {
        fsutil::read_to_string(path).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(|e| Error::Other(e.to_string()))?;
        fsutil::atomic_write(path, format!("{json}\n").as_bytes())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DigestItem {
    /// `<session id>:<category>:<index>`, stable because actions are append-only.
    pub id: String,
    pub text: String,
    pub session_id: String,
    pub session_title: Option<String>,
    #[serde(with = "serde_ts")]
    pub ts: Timestamp,
    pub entry_id: Option<String>,
    pub due: Option<String>,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct Digest {
    pub todos: Vec<DigestItem>,
    pub facts: Vec<DigestItem>,
    pub questions: Vec<DigestItem>,
    pub decisions: Vec<DigestItem>,
    pub ideas: Vec<DigestItem>,
}

/// Everything the agent kept across sessions, newest session first, with
/// to-dos carrying their done state.
pub fn digest(sessions: &[Session], todos: &TodoState) -> Digest {
    let mut out = Digest::default();
    for session in sessions.iter().rev() {
        let Some(applied) = applied(session) else { continue };
        let lists: [(&str, &Vec<Item>, &mut Vec<DigestItem>); 5] = [
            ("todo", &applied.todos, &mut out.todos),
            ("fact", &applied.facts, &mut out.facts),
            ("question", &applied.questions, &mut out.questions),
            ("decision", &applied.decisions, &mut out.decisions),
            ("idea", &applied.ideas, &mut out.ideas),
        ];
        for (category, items, target) in lists {
            for (index, item) in items.iter().enumerate() {
                let id = format!("{}:{}:{}", session.header.id, category, index);
                let ts = item
                    .entry_id
                    .as_ref()
                    .and_then(|eid| session.entries.iter().find(|e| &e.id == eid))
                    .map(|e| e.ts)
                    .unwrap_or(session.header.started);
                target.push(DigestItem {
                    done: todos.done.contains_key(&id),
                    id,
                    text: item.text.clone(),
                    session_id: session.header.id.clone(),
                    session_title: session.title().map(str::to_string),
                    ts,
                    entry_id: item.entry_id.clone(),
                    due: item.due.clone(),
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{normalize_entry, EndReason, Entry, SessionEnd, SessionHeader};
    use crate::store::NewSession;
    use crate::time::parse;

    fn session_with(entries: &[(&str, &str)]) -> Session {
        let header = SessionHeader {
            id: "S1".into(),
            profile: "work".into(),
            started: parse("2026-09-07T09:00:00+02:00").unwrap(),
            tz: "Europe/Madrid".into(),
            title: None,
            app: String::new(),
            device: None,
        };
        let mut s = Session::new(header);
        for (i, (time, text)) in entries.iter().enumerate() {
            s.entries.push(normalize_entry(Entry {
                id: format!("e{i}"),
                ts: parse(&format!("2026-09-07T{time}+02:00")).unwrap(),
                text: (*text).into(),
                tags: vec![],
                edited: None,
            }));
        }
        s.end = Some(SessionEnd { ended: parse("2026-09-07T10:00:00+02:00").unwrap(), entries: s.entries.len(), title: None, reason: EndReason::Manual });
        s
    }

    #[test]
    fn tags_become_categories_and_the_first_line_the_title() {
        let s = session_with(&[
            ("09:01:00", "Kickoff with ACME about the migration #kickoff"),
            ("09:02:00", "#todo Ask María for the Q4 budget\nsecond line"),
            ("09:03:00", "Their API limit is 600 req/min #data"),
            ("09:04:00", "#q Do we need SSO on day one?"),
            ("09:05:00", "#decision go with Postgres #idea and maybe cache per tenant"),
        ]);
        let p = from_tags(&s);
        assert_eq!(p.source, "tags");
        assert_eq!(p.title, "Kickoff with ACME about the migration");
        assert_eq!(p.todos, vec![Item { text: "Ask María for the Q4 budget second line".into(), entry_id: Some("e1".into()), due: None }]);
        assert_eq!(p.facts[0].text, "Their API limit is 600 req/min");
        assert_eq!(p.questions[0].text, "Do we need SSO on day one?");
        assert_eq!(p.decisions[0].entry_id.as_deref(), Some("e4"));
        assert_eq!(p.ideas[0].entry_id.as_deref(), Some("e4"));
        assert_eq!(strip_tags("#todo call #1 line #España"), "call #1 line");
    }

    #[test]
    fn merge_keeps_model_items_and_adds_missed_tagged_ones() {
        let s = session_with(&[("09:02:00", "#todo Ask María"), ("09:03:00", "#todo Send the deck")]);
        let tagged = from_tags(&s);
        let model = Proposal {
            title: "Budget follow-up".into(),
            summary: "Two things to chase.".into(),
            todos: vec![Item { text: "Ask María for the budget".into(), entry_id: Some("e0".into()), due: Some("2026-09-10".into()) }],
            source: "claude:test".into(),
            ..Default::default()
        };
        let merged = merge(model, &tagged);
        assert_eq!(merged.todos.len(), 2);
        assert_eq!(merged.todos[0].due.as_deref(), Some("2026-09-10"));
        assert_eq!(merged.todos[1].entry_id.as_deref(), Some("e1"));
        assert_eq!(merged.title, "Budget follow-up");
        let empty_title = merge(Proposal::default(), &tagged);
        assert_eq!(empty_title.title, "Ask María");
    }

    #[test]
    fn schema_is_strict_and_the_answer_parses() {
        let schema = schema();
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["properties"]["todos"]["items"]["additionalProperties"], false);
        let p = parse_response(r#"{"title":"T","summary":"S","todos":[{"text":"x","entry_id":null,"due":null}],"facts":[],"questions":[],"decisions":[],"ideas":[]}"#).unwrap();
        assert_eq!(p.todos[0].text, "x");
        assert!(parse_response("not json").is_err());
        assert!(!user_message(&session_with(&[("09:00:00", "hi")]), "Work").is_empty());
        assert!(system_prompt().contains("#todo"));
    }

    #[test]
    fn apply_writes_title_and_action_and_the_digest_reads_them_back() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("root"));
        let session = store
            .create_session(NewSession { profile: "work".into(), started: parse("2026-09-07T09:00:00+02:00").unwrap(), tz: "UTC".into(), app: String::new(), device: None })
            .unwrap();
        store
            .save_entries(
                "work",
                session.id(),
                vec![
                    Entry { id: "a".into(), ts: parse("2026-09-07T09:01:00+02:00").unwrap(), text: "#todo Ask María".into(), tags: vec![], edited: None },
                    Entry { id: "b".into(), ts: parse("2026-09-07T09:02:00+02:00").unwrap(), text: "limit 600 #data".into(), tags: vec![], edited: None },
                ],
            )
            .unwrap();
        store.end_session("work", session.id(), parse("2026-09-07T10:00:00+02:00").unwrap(), EndReason::Manual).unwrap();

        let proposal = Proposal {
            title: "Budget".into(),
            summary: "About the budget.".into(),
            todos: vec![
                Item { text: "Ask María".into(), entry_id: Some("a".into()), due: None },
                Item { text: "Dropped by the user".into(), entry_id: None, due: None },
            ],
            facts: vec![Item { text: "limit 600".into(), entry_id: Some("b".into()), due: None }],
            source: "tags".into(),
            ..Default::default()
        };
        let selection = Selection { title: Some("Budget kickoff".into()), summary: true, todos: vec![0], facts: vec![0], ..Default::default() };
        let now = parse("2026-09-07T10:05:00+02:00").unwrap();
        let updated = apply(&store, "work", session.id(), &proposal, &selection, now).unwrap();
        assert_eq!(updated.title(), Some("Budget kickoff"));
        assert_eq!(updated.actions.len(), 1);
        let kept = applied(&updated).unwrap();
        assert_eq!(kept.todos.len(), 1);
        assert_eq!(kept.summary.as_deref(), Some("About the budget."));
        let md = std::fs::read_to_string(store.markdown_path(&updated)).unwrap();
        assert!(md.starts_with("# Budget kickoff\n"));
        assert!(md.contains("About the budget."));
        assert!(md.contains("- [ ] Ask María"));

        let reloaded = store.read_session("work", session.id()).unwrap();
        assert_eq!(reloaded, updated);
        let mut todos = TodoState::default();
        let digest = digest(&[reloaded.clone()], &todos);
        assert_eq!(digest.todos.len(), 1);
        assert_eq!(digest.todos[0].id, format!("{}:todo:0", session.id()));
        assert_eq!(digest.todos[0].ts, parse("2026-09-07T09:01:00+02:00").unwrap());
        assert!(!digest.todos[0].done);
        assert_eq!(digest.facts[0].text, "limit 600");
        todos.done.insert(digest.todos[0].id.clone(), "2026-09-08".into());
        assert!(super::digest(&[reloaded], &todos).todos[0].done);
        let path = dir.path().join("todos.json");
        todos.save(&path).unwrap();
        assert_eq!(TodoState::load(&path), todos);
    }
}
