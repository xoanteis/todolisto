//! Rendered, read-only Markdown copy of a closed session. The JSONL file is
//! the source of truth; this copy exists so that notes are readable in Drive
//! previews and any editor.

use chrono::NaiveDate;

use crate::model::{EndReason, Session};

pub fn render(session: &Session) -> String {
    let h = &session.header;
    let title = session
        .title()
        .map(str::to_string)
        .unwrap_or_else(|| format!("Session {}", h.started.format("%Y-%m-%d %H:%M")));

    let mut out = String::new();
    out.push_str(&format!("# {title}\n\n"));

    let mut meta = format!(
        "Profile: {} · Started: {}",
        h.profile,
        h.started.format("%Y-%m-%d %H:%M:%S %:z")
    );
    if let Some(end) = &session.end {
        meta.push_str(&format!(" · Ended: {}", end.ended.format("%Y-%m-%d %H:%M:%S")));
        match end.reason {
            EndReason::Manual => {}
            EndReason::Inactivity => meta.push_str(" (closed after inactivity)"),
            EndReason::TakenOver => meta.push_str(" (taken over from another device)"),
        }
    }
    meta.push_str(&format!(" · Entries: {}", session.entries.len()));
    if let Some(device) = &h.device {
        meta.push_str(&format!(" · Device: {device}"));
    }
    out.push_str(&meta);
    out.push_str("\n\n");

    let mut current_day: Option<NaiveDate> = None;
    for e in &session.entries {
        let day = e.ts.date_naive();
        if current_day != Some(day) {
            if current_day.is_some() {
                out.push('\n');
            }
            out.push_str(&format!("## {}\n\n", e.ts.format("%A %-d %B %Y")));
            current_day = Some(day);
        }
        let mut lines = e.text.lines();
        let first = lines.next().unwrap_or("");
        out.push_str(&format!("- **{}** {first}", e.ts.format("%H:%M:%S")));
        for line in lines {
            out.push_str(&format!("\n  {line}"));
        }
        if e.edited.is_some() {
            out.push_str(" _(edited)_");
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Entry, SessionEnd, SessionHeader};
    use crate::time::parse;

    #[test]
    fn renders_days_entries_and_continuation_lines() {
        let header = SessionHeader {
            id: "01J9Z6K3A0Q5H7R8C4T6M1W2XY".into(),
            profile: "work".into(),
            started: parse("2026-09-07T09:31:05+02:00").unwrap(),
            tz: "Europe/Madrid".into(),
            title: None,
            app: "todolisto/0.1.0".into(),
            device: Some("laptop".into()),
        };
        let mut s = Session::new(header);
        s.entries.push(Entry {
            id: "a".into(),
            ts: parse("2026-09-07T09:31:05+02:00").unwrap(),
            text: "Kickoff with ACME\nsecond line".into(),
            tags: vec![],
            edited: None,
        });
        s.entries.push(Entry {
            id: "b".into(),
            ts: parse("2026-09-08T08:00:00+02:00").unwrap(),
            text: "#todo Ask Maria".into(),
            tags: vec!["todo".into()],
            edited: Some(parse("2026-09-08T08:05:00+02:00").unwrap()),
        });
        s.end = Some(SessionEnd {
            ended: parse("2026-09-08T08:10:00+02:00").unwrap(),
            entries: 2,
            title: Some("Kickoff".into()),
            reason: EndReason::Inactivity,
        });
        let md = render(&s);
        let expected = "# Kickoff\n\n\
Profile: work · Started: 2026-09-07 09:31:05 +02:00 · Ended: 2026-09-08 08:10:00 (closed after inactivity) · Entries: 2 · Device: laptop\n\n\
## Monday 7 September 2026\n\n\
- **09:31:05** Kickoff with ACME\n  second line\n\n\
## Tuesday 8 September 2026\n\n\
- **08:00:00** #todo Ask Maria _(edited)_\n";
        assert_eq!(md, expected);
    }
}
