use std::fs;

use todolisto_core::store::NewSession;
use todolisto_core::time::{parse, Timestamp};
use todolisto_core::{EndReason, Entry, Error, Store};

fn ts(s: &str) -> Timestamp {
    parse(s).unwrap()
}

fn entry(id: &str, at: &str, text: &str) -> Entry {
    Entry { id: id.into(), ts: ts(at), text: text.into(), tags: vec![], edited: None }
}

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("root"));
    (dir, store)
}

fn new_session(profile: &str, started: &str) -> NewSession {
    NewSession {
        profile: profile.into(),
        started: ts(started),
        tz: "Europe/Madrid".into(),
        app: "todolisto/test".into(),
        device: Some("pc-1".into()),
    }
}

#[test]
fn session_lifecycle_create_save_end_reopen() {
    let (_dir, store) = store();
    let session = store.create_session(new_session("work", "2026-09-07T09:31:05.123+02:00")).unwrap();
    assert!(session.is_open());
    let path = store.session_path(&session);
    assert!(path.ends_with(format!("data/work/2026/{}.jsonl", session.file_stem())));
    assert!(path.exists());

    let saved = store
        .save_entries(
            "work",
            session.id(),
            vec![
                entry("e1", "2026-09-07T09:31:05.123+02:00", "Kickoff with ACME  \n"),
                entry("e2", "2026-09-07T09:32:40.502+02:00", "#todo Ask Maria\nsecond line"),
                entry("e3", "2026-09-07T09:33:00.000+02:00", "   "),
            ],
        )
        .unwrap();
    assert_eq!(saved.entries.len(), 2, "blank entries are dropped");
    assert_eq!(saved.entries[0].text, "Kickoff with ACME");
    assert_eq!(saved.entries[1].tags, vec!["todo"]);

    let listed = store.list_sessions("work").unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].open);
    assert_eq!(listed[0].entries, 2);
    assert_eq!(listed[0].todos, 1);
    assert_eq!(store.open_session("work").unwrap().unwrap().id(), session.id());
    assert!(store.open_session("personal").unwrap().is_none());

    let closed = store
        .end_session("work", session.id(), ts("2026-09-07T10:45:12+02:00"), EndReason::Manual)
        .unwrap()
        .unwrap();
    assert!(!closed.is_open());
    assert_eq!(closed.end.as_ref().unwrap().entries, 2);
    let md = fs::read_to_string(store.markdown_path(&closed)).unwrap();
    assert!(md.starts_with("# Session 2026-09-07 09:31\n"));
    assert!(md.contains("- **09:32:40** #todo Ask Maria\n  second line\n"));
    assert!(store.open_session("work").unwrap().is_none());

    let err = store.save_entries("work", session.id(), vec![]).unwrap_err();
    assert!(matches!(err, Error::SessionClosed(_)));

    let reopened = store.reopen_session("work", session.id()).unwrap();
    assert!(reopened.is_open());
    assert!(!store.markdown_path(&reopened).exists());
    assert_eq!(store.read_session("work", session.id()).unwrap(), reopened);
}

#[test]
fn ending_an_empty_session_deletes_the_file() {
    let (_dir, store) = store();
    let session = store.create_session(new_session("work", "2026-09-07T09:31:05+02:00")).unwrap();
    let path = store.session_path(&session);
    assert!(path.exists());
    let result = store
        .end_session("work", session.id(), ts("2026-09-07T09:40:00+02:00"), EndReason::Manual)
        .unwrap();
    assert!(result.is_none());
    assert!(!path.exists());
    assert!(store.list_sessions("work").unwrap().is_empty());
}

#[test]
fn reopen_is_refused_while_another_session_has_entries() {
    let (_dir, store) = store();
    let first = store.create_session(new_session("work", "2026-09-07T09:00:00+02:00")).unwrap();
    store
        .save_entries("work", first.id(), vec![entry("a", "2026-09-07T09:00:00+02:00", "one")])
        .unwrap();
    store.end_session("work", first.id(), ts("2026-09-07T09:30:00+02:00"), EndReason::Manual).unwrap();

    let second = store.create_session(new_session("work", "2026-09-07T10:00:00+02:00")).unwrap();
    // An empty open session does not block reopening; it is discarded.
    let reopened = store.reopen_session("work", first.id()).unwrap();
    assert_eq!(reopened.id(), first.id());
    assert!(!store.session_path(&second).exists());
    store.end_session("work", first.id(), ts("2026-09-07T10:30:00+02:00"), EndReason::Manual).unwrap();

    let third = store.create_session(new_session("work", "2026-09-07T11:00:00+02:00")).unwrap();
    store
        .save_entries("work", third.id(), vec![entry("b", "2026-09-07T11:00:00+02:00", "busy")])
        .unwrap();
    let err = store.reopen_session("work", first.id()).unwrap_err();
    assert!(matches!(err, Error::AnotherSessionOpen));
}

#[test]
fn auto_close_uses_last_activity_and_respects_the_threshold() {
    let (_dir, store) = store();
    let session = store.create_session(new_session("work", "2026-09-07T09:00:00+02:00")).unwrap();
    let mut edited = entry("a", "2026-09-07T09:05:00+02:00", "note");
    edited.edited = Some(ts("2026-09-07T09:20:00+02:00"));
    store.save_entries("work", session.id(), vec![edited]).unwrap();

    // 89 minutes after the last edit: still open.
    assert!(store
        .auto_close_if_inactive("work", ts("2026-09-07T10:49:00+02:00"), 90)
        .unwrap()
        .is_none());
    // Disabled rule: never closes.
    assert!(store
        .auto_close_if_inactive("work", ts("2026-09-08T10:49:00+02:00"), 0)
        .unwrap()
        .is_none());
    // 90 minutes after: closed at the time of the last edit, reason inactivity.
    let closed = store
        .auto_close_if_inactive("work", ts("2026-09-07T10:50:00+02:00"), 90)
        .unwrap()
        .unwrap();
    let end = closed.end.unwrap();
    assert_eq!(end.ended, ts("2026-09-07T09:20:00+02:00"));
    assert_eq!(end.reason, EndReason::Inactivity);
    assert!(store.open_session("work").unwrap().is_none());
}

#[test]
fn unknown_record_kinds_are_ignored_and_bad_json_is_reported() {
    let (_dir, store) = store();
    let session = store.create_session(new_session("work", "2026-09-07T09:00:00+02:00")).unwrap();
    let path = store.session_path(&session);
    let mut raw = fs::read_to_string(&path).unwrap();
    raw.push_str("{\"kind\":\"future_thing\",\"x\":1}\n");
    raw.push_str("{\"kind\":\"entry\",\"id\":\"z\",\"ts\":\"2026-09-07T09:10:00+02:00\",\"text\":\"kept\"}\n");
    fs::write(&path, raw).unwrap();
    let loaded = store.read_session("work", session.id()).unwrap();
    assert_eq!(loaded.entries.len(), 1);
    assert_eq!(loaded.entries[0].text, "kept");

    fs::write(&path, "{\"kind\":\"session\"").unwrap();
    let err = store.read_session("work", session.id()).unwrap_err();
    match err {
        Error::Parse { line, .. } => assert_eq!(line, 1),
        other => panic!("unexpected error {other:?}"),
    }
}

#[test]
fn sessions_are_listed_in_start_order_across_years() {
    let (_dir, store) = store();
    let late = store.create_session(new_session("personal", "2027-01-02T08:00:00+01:00")).unwrap();
    let early = store.create_session(new_session("personal", "2026-12-31T23:00:00+01:00")).unwrap();
    for s in [&late, &early] {
        store
            .save_entries("personal", s.id(), vec![entry("x", "2026-12-31T23:00:00+01:00", "x")])
            .unwrap();
    }
    let ids: Vec<String> = store.list_sessions("personal").unwrap().into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec![early.id().to_string(), late.id().to_string()]);
    assert!(store.read_session("personal", "missing").is_err());
}

#[test]
fn user_dictionary_and_autocorrect_rules_per_profile() {
    let (_dir, store) = store();
    assert!(store.user_words("work").unwrap().is_empty());
    assert_eq!(store.add_user_word("work", " Xoán ").unwrap(), vec!["Xoán"]);
    assert_eq!(store.add_user_word("work", "ACME").unwrap(), vec!["Xoán", "ACME"]);
    assert_eq!(store.add_user_word("work", "ACME").unwrap(), vec!["Xoán", "ACME"], "no duplicates");
    assert!(store.add_user_word("work", "two words").is_err());
    assert!(store.add_user_word("work", "  ").is_err());
    assert!(store.user_words("personal").unwrap().is_empty(), "dictionaries are per profile");
    let raw = fs::read_to_string(store.profile_dir("work").join("dictionary.txt")).unwrap();
    assert_eq!(raw, "Xoán\nACME\n");

    assert!(store.autocorrect_rules("work").unwrap().is_empty());
    fs::write(
        store.profile_dir("work").join("autocorrect.txt"),
        "# personal shortcuts\nTBD = to be defined\nqeu=que\nbroken line\n = nothing\n",
    )
    .unwrap();
    let rules = store.autocorrect_rules("work").unwrap();
    assert_eq!(rules.len(), 2);
    assert_eq!(rules["tbd"], "to be defined");
    assert_eq!(rules["qeu"], "que");
}

#[test]
fn open_sessions_started_elsewhere_are_not_ours() {
    let (_dir, store) = store();
    let theirs = store
        .create_session(NewSession { device: Some("pc-2".into()), ..new_session("work", "2026-09-07T09:00:00+02:00") })
        .unwrap();
    store
        .save_entries("work", theirs.id(), vec![entry("a", "2026-09-07T09:00:00+02:00", "on the other pc")])
        .unwrap();
    assert_eq!(store.open_session("work").unwrap().unwrap().id(), theirs.id(), "no device filter: any open session");
    assert!(store.open_session_for("work", Some("pc-1")).unwrap().is_none());
    assert!(store
        .auto_close_if_inactive_for("work", Some("pc-1"), ts("2026-09-08T09:00:00+02:00"), 90)
        .unwrap()
        .is_none());
    let mine = store.create_session(new_session("work", "2026-09-07T10:00:00+02:00")).unwrap();
    assert_eq!(store.open_session_for("work", Some("pc-1")).unwrap().unwrap().id(), mine.id());
}
