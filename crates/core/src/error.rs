use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid data in {path} (line {line}): {message}")]
    Parse {
        path: PathBuf,
        line: usize,
        message: String,
    },
    #[error("session {0} not found")]
    SessionNotFound(String),
    #[error("session {0} is already closed")]
    SessionClosed(String),
    #[error("session {0} is still open")]
    SessionOpen(String),
    #[error("another session is open with entries; close it before reopening an older one")]
    AnotherSessionOpen,
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Error::Io { path: path.into(), source }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
