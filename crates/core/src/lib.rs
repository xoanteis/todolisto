//! Core of todolisto: the session/entry model, the JSONL store, the Markdown
//! renderer and the settings file. This crate has no UI or Tauri dependency so
//! that all of it can be unit-tested on any platform.

pub mod error;
pub mod fsutil;
pub mod geometry;
pub mod markdown;
pub mod model;
pub mod settings;
pub mod store;
pub mod time;

pub use error::{Error, Result};
pub use geometry::{Rect, WindowGeometry};
pub use model::{Action, EndReason, Entry, Record, Session, SessionEnd, SessionHeader, SessionSummary};
pub use settings::{Profile, Settings};
pub use store::Store;
