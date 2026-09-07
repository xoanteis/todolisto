//! OAuth 2.0 for installed apps: authorization code with PKCE, the browser
//! redirects to a loopback port we listen on, then codes and refresh tokens
//! are exchanged at Google's token endpoint.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const SCOPES: &str = "https://www.googleapis.com/auth/drive.file openid email";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

#[derive(Clone, Debug)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Clone, Debug)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix seconds.
    pub expires_at: u64,
    pub email: Option<String>,
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A PKCE verifier and its S256 challenge.
pub fn pkce() -> (String, String) {
    let verifier = b64url(&rand::random::<[u8; 32]>());
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(&text[i + 1..i + 3], 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Query parameters of an HTTP request line such as `GET /?code=x&state=y HTTP/1.1`.
pub fn parse_query(request_line: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    let Some(target) = request_line.split_whitespace().nth(1) else { return params };
    let Some((_, query)) = target.split_once('?') else { return params };
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            params.insert(percent_decode(k), percent_decode(v));
        }
    }
    params
}

/// The `email` claim of an ID token. The token comes straight from Google's
/// token endpoint over TLS, so it is read, not verified.
pub fn decode_jwt_email(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("email").and_then(|e| e.as_str()).map(str::to_string)
}

/// Runs the sign-in: opens the browser, waits for Google to redirect to the
/// loopback port and exchanges the code. Blocks up to `timeout`.
pub fn authorize_blocking(client: &OAuthClient, timeout: Duration, open_browser: &dyn Fn(&str)) -> Result<Tokens, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("cannot open a local port for the sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let (verifier, challenge) = pkce();
    let expected_state = b64url(&rand::random::<[u8; 16]>());

    let mut auth = url::Url::parse(AUTH_URL).map_err(|e| e.to_string())?;
    auth.query_pairs_mut()
        .append_pair("client_id", &client.client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &expected_state);

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let mut buffer = [0u8; 8192];
            let read = stream.read(&mut buffer).unwrap_or(0);
            let text = String::from_utf8_lossy(&buffer[..read]).into_owned();
            let params = parse_query(text.lines().next().unwrap_or(""));
            let done = params.contains_key("code") || params.contains_key("error");
            let body = if params.contains_key("code") {
                "<!doctype html><html><body style=\"font-family:sans-serif;padding:2rem\"><h2>todolisto is connected.</h2><p>You can close this tab and go back to the app.</p></body></html>"
            } else if params.contains_key("error") {
                "<!doctype html><html><body style=\"font-family:sans-serif;padding:2rem\"><h2>Sign-in cancelled.</h2><p>You can close this tab.</p></body></html>"
            } else {
                "<!doctype html><html><body></body></html>"
            };
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.flush();
            if done {
                let _ = tx.send(params);
                break;
            }
        }
    });

    open_browser(auth.as_str());

    let params = rx
        .recv_timeout(timeout)
        .map_err(|_| "Timed out waiting for the Google sign-in to finish".to_string())?;
    if params.get("state") != Some(&expected_state) {
        return Err("The sign-in response did not match the request (state mismatch)".into());
    }
    if let Some(error) = params.get("error") {
        return Err(format!("Google sign-in failed: {error}"));
    }
    let code = params.get("code").ok_or_else(|| "No authorization code received".to_string())?;
    exchange(
        client,
        &[("code", code), ("code_verifier", &verifier), ("redirect_uri", &redirect), ("grant_type", "authorization_code")],
    )
}

pub fn refresh_blocking(client: &OAuthClient, refresh_token: &str) -> Result<Tokens, String> {
    exchange(client, &[("refresh_token", refresh_token), ("grant_type", "refresh_token")])
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: u64,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

fn exchange(client: &OAuthClient, extra: &[(&str, &str)]) -> Result<Tokens, String> {
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut form: Vec<(&str, &str)> = vec![("client_id", &client.client_id), ("client_secret", &client.client_secret)];
    form.extend_from_slice(extra);
    let response = http.post(TOKEN_URL).form(&form).send().map_err(|e| format!("token request failed: {e}"))?;
    let status = response.status();
    let body = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let message = serde_json::from_str::<TokenError>(&body)
            .map(|e| match e.error_description {
                Some(d) => format!("{} ({})", d, e.error),
                None => e.error,
            })
            .unwrap_or_else(|_| format!("HTTP {status}"));
        return Err(format!("Google rejected the token request: {message}"));
    }
    let parsed: TokenResponse = serde_json::from_str(&body).map_err(|e| format!("unexpected token response: {e}"))?;
    Ok(Tokens {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at: now_secs() + parsed.expires_in.max(60),
        email: parsed.id_token.as_deref().and_then(decode_jwt_email),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_redirect_request_line() {
        let params = parse_query("GET /?code=4%2FabC-d&state=xyz&scope=email%20openid HTTP/1.1");
        assert_eq!(params["code"], "4/abC-d");
        assert_eq!(params["state"], "xyz");
        assert_eq!(params["scope"], "email openid");
        assert!(parse_query("GET /favicon.ico HTTP/1.1").is_empty());
        assert!(parse_query("").is_empty());
    }

    #[test]
    fn pkce_challenge_is_the_s256_of_the_verifier() {
        let (verifier, challenge) = pkce();
        assert!(verifier.len() >= 43);
        assert_eq!(challenge, b64url(&Sha256::digest(verifier.as_bytes())));
        assert!(!challenge.contains('=') && !challenge.contains('+') && !challenge.contains('/'));
    }

    #[test]
    fn reads_the_email_claim() {
        let payload = b64url(br#"{"sub":"1","email":"me@example.com"}"#);
        assert_eq!(decode_jwt_email(&format!("h.{payload}.s")), Some("me@example.com".into()));
        assert_eq!(decode_jwt_email("garbage"), None);
    }
}
