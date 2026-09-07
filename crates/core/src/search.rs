//! Search across sessions. The corpus of a personal notes app is small (tens
//! of thousands of entries at most), so a linear scan over parsed sessions
//! answers in milliseconds without an index or a native database.
//!
//! Matching is case-insensitive and ignores diacritics (`reunion` finds
//! `reunión`). Every word of the query must appear; a query that appears as
//! a whole phrase ranks first. `#tag` words in the query become tag filters.

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::model::Session;
use crate::time::{serde_ts, Timestamp};

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub text: String,
    /// Entries must carry all of these tags (lower-case, without `#`).
    #[serde(default)]
    pub tags: Vec<String>,
    /// Restrict to one session.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Inclusive day bounds, `YYYY-MM-DD` in the writer's local date.
    #[serde(default)]
    pub from_day: Option<String>,
    #[serde(default)]
    pub to_day: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchHit {
    pub session_id: String,
    pub session_title: Option<String>,
    pub session_open: bool,
    pub entry_id: String,
    #[serde(with = "serde_ts")]
    pub ts: Timestamp,
    pub text: String,
    pub tags: Vec<String>,
    /// `[start, end)` character ranges in `text` of the matched query words.
    pub highlights: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// Number of matching entries before the limit was applied.
    pub total: usize,
}

pub const DEFAULT_LIMIT: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

/// Every tag used across sessions, most used first, then alphabetical.
pub fn tag_counts(sessions: &[Session]) -> Vec<TagCount> {
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for session in sessions {
        for entry in &session.entries {
            for tag in &entry.tags {
                *counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut out: Vec<TagCount> = counts.into_iter().map(|(tag, count)| TagCount { tag, count }).collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
    out
}

/// Lower-cases and strips diacritics one character at a time, so that the
/// result has exactly one char per input char and offsets stay aligned.
pub fn fold(text: &str) -> String {
    text.chars()
        .map(|c| {
            let base = c.nfd().find(|d| !is_combining_mark(*d)).unwrap_or(c);
            base.to_lowercase().next().unwrap_or(base)
        })
        .collect()
}

fn is_combining_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

struct Parsed {
    words: Vec<Vec<char>>,
    phrase: Vec<char>,
    tags: Vec<String>,
}

fn parse_query(query: &SearchQuery) -> Parsed {
    let mut words = Vec::new();
    let mut tags: Vec<String> = query
        .tags
        .iter()
        .map(|t| fold(t.trim_start_matches('#')))
        .filter(|t| !t.is_empty())
        .collect();
    let mut phrase_words: Vec<String> = Vec::new();
    for raw in query.text.split_whitespace() {
        if let Some(tag) = raw.strip_prefix('#') {
            let tag = fold(tag);
            if !tag.is_empty() && !tags.contains(&tag) {
                tags.push(tag);
            }
            continue;
        }
        let folded = fold(raw);
        if !folded.is_empty() {
            phrase_words.push(folded.clone());
            words.push(folded.chars().collect());
        }
    }
    Parsed { words, phrase: phrase_words.join(" ").chars().collect(), tags }
}

/// All `[start, end)` positions of `needle` in `haystack` (char indices).
fn find_all(haystack: &[char], needle: &[char]) -> Vec<(usize, usize)> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    let mut i = 0;
    while i + needle.len() <= haystack.len() {
        if haystack[i..i + needle.len()] == *needle {
            hits.push((i, i + needle.len()));
            i += needle.len();
        } else {
            i += 1;
        }
    }
    hits
}

fn day_of(ts: &Timestamp) -> String {
    ts.format("%Y-%m-%d").to_string()
}

pub fn search(sessions: &[Session], query: &SearchQuery) -> SearchResult {
    let parsed = parse_query(query);
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).max(1);
    let mut ranked: Vec<(u8, SearchHit)> = Vec::new();

    for session in sessions {
        if let Some(wanted) = &query.session_id {
            if &session.header.id != wanted {
                continue;
            }
        }
        for entry in &session.entries {
            if !parsed.tags.iter().all(|t| entry.tags.iter().any(|et| fold(et) == *t)) {
                continue;
            }
            let day = day_of(&entry.ts);
            if query.from_day.as_ref().is_some_and(|from| day < *from)
                || query.to_day.as_ref().is_some_and(|to| day > *to)
            {
                continue;
            }
            let folded: Vec<char> = fold(&entry.text).chars().collect();
            let mut highlights = Vec::new();
            let mut all_words = true;
            for word in &parsed.words {
                let found = find_all(&folded, word);
                if found.is_empty() {
                    all_words = false;
                    break;
                }
                highlights.extend(found);
            }
            if !all_words {
                continue;
            }
            let rank = if parsed.words.len() > 1 && !find_all(&folded, &parsed.phrase).is_empty() { 0 } else { 1 };
            highlights.sort_unstable();
            highlights.dedup();
            ranked.push((
                rank,
                SearchHit {
                    session_id: session.header.id.clone(),
                    session_title: session.title().map(str::to_string),
                    session_open: session.is_open(),
                    entry_id: entry.id.clone(),
                    ts: entry.ts,
                    text: entry.text.clone(),
                    tags: entry.tags.clone(),
                    highlights,
                },
            ));
        }
    }

    ranked.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.ts.cmp(&a.1.ts)));
    let total = ranked.len();
    SearchResult { hits: ranked.into_iter().take(limit).map(|(_, hit)| hit).collect(), total }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{normalize_entry, Entry, SessionEnd, SessionHeader};
    use crate::time::parse;

    fn session(id: &str, day: &str, entries: &[(&str, &str, &str)], open: bool) -> Session {
        let header = SessionHeader {
            id: id.into(),
            profile: "work".into(),
            started: parse(&format!("{day}T09:00:00+02:00")).unwrap(),
            tz: "Europe/Madrid".into(),
            title: Some(format!("Session {id}")),
            app: String::new(),
            device: None,
        };
        let mut s = Session::new(header);
        for (eid, time, text) in entries {
            s.entries.push(normalize_entry(Entry {
                id: (*eid).into(),
                ts: parse(&format!("{day}T{time}+02:00")).unwrap(),
                text: (*text).into(),
                tags: vec![],
                edited: None,
            }));
        }
        if !open {
            s.end = Some(SessionEnd {
                ended: parse(&format!("{day}T12:00:00+02:00")).unwrap(),
                entries: s.entries.len(),
                title: None,
                reason: Default::default(),
            });
        }
        s
    }

    fn corpus() -> Vec<Session> {
        vec![
            session(
                "A",
                "2026-09-01",
                &[
                    ("a1", "09:10:00", "Reunión con María sobre el presupuesto #todo"),
                    ("a2", "09:20:00", "Idea: cache por tenant #idea"),
                ],
                false,
            ),
            session(
                "B",
                "2026-09-07",
                &[
                    ("b1", "10:00:00", "Kickoff with ACME about the budget"),
                    ("b2", "10:05:00", "María owes us the Q4 numbers #todo\nsecond line"),
                    ("b3", "10:07:00", "budget review with maria next week"),
                ],
                true,
            ),
        ]
    }

    #[test]
    fn folding_ignores_case_and_accents_and_keeps_length() {
        assert_eq!(fold("Reunión María ÁÉÍÓÚ ñ"), "reunion maria aeiou n");
        assert_eq!(fold("Straße").chars().count(), "Straße".chars().count());
    }

    #[test]
    fn matches_all_words_without_accents_and_highlights() {
        let result = search(&corpus(), &SearchQuery { text: "maria".into(), ..Default::default() });
        assert_eq!(result.total, 3);
        let ids: Vec<&str> = result.hits.iter().map(|h| h.entry_id.as_str()).collect();
        assert_eq!(ids, vec!["b3", "b2", "a1"], "newest first when ranks tie");
        let a1 = result.hits.iter().find(|h| h.entry_id == "a1").unwrap();
        assert_eq!(a1.highlights, vec![(12, 17)]);
        assert_eq!(a1.text.chars().skip(12).take(5).collect::<String>(), "María");
        assert_eq!(a1.session_title.as_deref(), Some("Session A"));
        assert!(!a1.session_open);
    }

    #[test]
    fn phrase_matches_rank_first_and_tags_filter() {
        let result = search(&corpus(), &SearchQuery { text: "budget maria".into(), ..Default::default() });
        assert_eq!(result.hits.iter().map(|h| h.entry_id.as_str()).collect::<Vec<_>>(), vec!["b3"]);
        let phrase = search(&corpus(), &SearchQuery { text: "with maria".into(), ..Default::default() });
        assert_eq!(phrase.hits[0].entry_id, "b3");

        let todos = search(&corpus(), &SearchQuery { text: "#todo".into(), ..Default::default() });
        assert_eq!(todos.hits.iter().map(|h| h.entry_id.as_str()).collect::<Vec<_>>(), vec!["b2", "a1"]);
        let mixed = search(&corpus(), &SearchQuery { text: "maria".into(), tags: vec!["#TODO".into()], ..Default::default() });
        assert_eq!(mixed.total, 2);
        let none = search(&corpus(), &SearchQuery { text: "#idea maria".into(), ..Default::default() });
        assert_eq!(none.total, 0);
    }

    #[test]
    fn tags_are_counted_across_sessions() {
        let counts = tag_counts(&corpus());
        assert_eq!(counts[0], TagCount { tag: "todo".into(), count: 2 });
        assert_eq!(counts[1], TagCount { tag: "idea".into(), count: 1 });
        assert_eq!(counts.len(), 2);
    }

    #[test]
    fn day_bounds_session_scope_and_limit() {
        let week = search(&corpus(), &SearchQuery { from_day: Some("2026-09-07".into()), ..Default::default() });
        assert_eq!(week.total, 3);
        let early = search(&corpus(), &SearchQuery { to_day: Some("2026-09-01".into()), ..Default::default() });
        assert_eq!(early.total, 2);
        let scoped = search(&corpus(), &SearchQuery { session_id: Some("A".into()), ..Default::default() });
        assert_eq!(scoped.total, 2);
        let limited = search(&corpus(), &SearchQuery { limit: Some(2), ..Default::default() });
        assert_eq!(limited.total, 5);
        assert_eq!(limited.hits.len(), 2);
        assert_eq!(limited.hits[0].entry_id, "b3");
    }
}
