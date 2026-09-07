//! Google Drive sync: OAuth sign-in, the Drive REST client, encrypted token
//! storage and the background service that drives the core sync engine.

pub mod api;
pub mod oauth;
pub mod secrets;
pub mod service;
