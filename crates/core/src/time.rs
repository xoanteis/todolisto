//! Timestamps are RFC 3339 strings with millisecond precision and the local UTC
//! offset at the moment of writing, e.g. `2026-09-07T09:31:05.123+02:00`.
//! Keeping the writer's offset means notes taken on a trip still read with the
//! local time of that place, and agents can reason about the wall clock.

use chrono::{DateTime, FixedOffset, Local, SecondsFormat};
use serde::{Deserialize, Deserializer, Serializer};

pub type Timestamp = DateTime<FixedOffset>;

pub fn now() -> Timestamp {
    Local::now().fixed_offset()
}

/// IANA name of the machine's timezone (`Europe/Madrid`), `UTC` if unknown.
pub fn local_tz_name() -> String {
    iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_string())
}

pub fn format(ts: &Timestamp) -> String {
    ts.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn parse(s: &str) -> Result<Timestamp, chrono::ParseError> {
    DateTime::parse_from_rfc3339(s.trim())
}

/// `YYYY-MM-DDTHHMMSS` in the timestamp's own offset; used in file names.
pub fn file_stamp(ts: &Timestamp) -> String {
    ts.format("%Y-%m-%dT%H%M%S").to_string()
}

pub mod serde_ts {
    use super::*;

    pub fn serialize<S: Serializer>(ts: &Timestamp, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format(ts))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Timestamp, D::Error> {
        let raw = String::deserialize(d)?;
        parse(&raw).map_err(serde::de::Error::custom)
    }
}

pub mod serde_ts_opt {
    use super::*;

    pub fn serialize<S: Serializer>(ts: &Option<Timestamp>, s: S) -> Result<S::Ok, S::Error> {
        match ts {
            Some(ts) => s.serialize_some(&format(ts)),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Timestamp>, D::Error> {
        let raw: Option<String> = Option::deserialize(d)?;
        match raw {
            Some(r) if !r.trim().is_empty() => parse(&r).map(Some).map_err(serde::de::Error::custom),
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_keeps_offset_and_millis() {
        let ts = parse("2026-09-07T09:31:05.123+02:00").unwrap();
        assert_eq!(format(&ts), "2026-09-07T09:31:05.123+02:00");
        assert_eq!(file_stamp(&ts), "2026-09-07T093105");
    }

    #[test]
    fn format_pads_millis() {
        let ts = parse("2026-09-07T09:31:05Z").unwrap();
        assert_eq!(format(&ts), "2026-09-07T09:31:05.000Z");
    }
}
