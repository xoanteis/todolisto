//! Raw HTTPS call to the Claude Messages API with a structured JSON answer.
//! Blocking; always used from a worker thread.

use std::time::Duration;

use serde::Deserialize;

const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

pub struct Request<'a> {
    pub api_key: &'a str,
    pub model: &'a str,
    pub system: &'a str,
    pub user: &'a str,
    pub schema: serde_json::Value,
}

pub struct Answer {
    pub json: String,
    pub model: String,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct MessageResponse {
    #[serde(default)]
    model: String,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    message: String,
}

fn supports_fallbacks(model: &str) -> bool {
    model.starts_with("claude-opus-5") || model.starts_with("claude-fable")
}

pub fn complete(request: &Request<'_>) -> Result<Answer, String> {
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(240))
        .build()
        .map_err(|e| e.to_string())?;

    let mut body = serde_json::json!({
        "model": request.model,
        "max_tokens": 8000,
        "thinking": { "type": "adaptive" },
        "output_config": {
            "effort": "medium",
            "format": { "type": "json_schema", "schema": request.schema }
        },
        "system": request.system,
        "messages": [{ "role": "user", "content": request.user }],
    });
    let mut call = http
        .post(MESSAGES_URL)
        .header("x-api-key", request.api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json");
    if supports_fallbacks(request.model) {
        // A safety-classifier decline is re-run server-side on Anthropic's
        // recommended fallback model instead of failing the review.
        body["fallbacks"] = serde_json::json!("default");
        call = call.header("anthropic-beta", FALLBACK_BETA);
    }

    let response = call.json(&body).send().map_err(|e| format!("cannot reach the Claude API: {e}"))?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = serde_json::from_str::<ApiError>(&text)
            .map(|e| format!("{} ({})", e.error.message, e.error.kind))
            .unwrap_or_else(|_| text.chars().take(300).collect());
        return Err(match status.as_u16() {
            401 => format!("the Anthropic API key was rejected: {detail}"),
            429 => format!("the Claude API is rate limiting requests, try again in a minute: {detail}"),
            _ => format!("Claude API error HTTP {status}: {detail}"),
        });
    }
    let message: MessageResponse = serde_json::from_str(&text).map_err(|e| format!("unexpected Claude API response: {e}"))?;
    match message.stop_reason.as_deref() {
        Some("refusal") => return Err("Claude declined to process these notes".to_string()),
        Some("max_tokens") => return Err("the answer was cut short (max_tokens); try again".to_string()),
        _ => {}
    }
    let json: String = message.content.iter().filter(|b| b.kind == "text").filter_map(|b| b.text.clone()).collect();
    if json.trim().is_empty() {
        return Err("Claude returned an empty answer".to_string());
    }
    Ok(Answer { json, model: message.model })
}
