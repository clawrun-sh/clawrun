//! Streaming WebSocket agent chat handler.
//!
//! Unlike `/ws/chat` which blocks until the full agent loop completes and then
//! sends a single sanitized `done` message, this endpoint streams events in
//! real-time via the existing `on_delta` channel from `run_tool_call_loop`.
//!
//! **Key differences from ws.rs:**
//! 1. **Streaming** — progress, tool status, and text chunks arrive as they happen
//! 2. **Multi-turn history** — prior conversation turns are passed to the tool loop
//! 3. **No sanitization** — raw response is sent so the TS client can parse XML tags
//!    (`<thinking>`, `<tool_call>`, `<tool_result>`, `<response>`) via StreamingTagParser
//!
//! Protocol (server → client):
//! ```text
//! {"type":"history","session_id":"...","messages":[...]}
//! {"type":"status","content":"🤔 Thinking..."}
//! {"type":"tool_progress","content":"⏳ shell: ls -la\n..."}
//! {"type":"chunk","content":"Here is the answer..."}
//! {"type":"clear"}
//! {"type":"done","full_response":"..."}
//! {"type":"error","message":"..."}
//! ```
//!
//! Client → Server:
//! ```text
//! {"type":"message","content":"Hello"}
//! ```

use super::AppState;
use crate::agent::loop_::{
    build_shell_policy_instructions, build_tool_instructions_from_specs,
    DRAFT_CLEAR_SENTINEL, DRAFT_PROGRESS_BLOCK_SENTINEL, DRAFT_PROGRESS_SENTINEL,
};
use crate::memory::MemoryCategory;
use crate::providers::ChatMessage;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, RawQuery, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap},
    response::IntoResponse,
};
use serde_json::json;
use std::net::SocketAddr;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_HISTORY_MEMORY_KEY_PREFIX: &str = "gateway_ws_history";
const MAX_WS_PERSISTED_TURNS: usize = 128;
const MAX_WS_SESSION_ID_LEN: usize = 128;

// ---------------------------------------------------------------------------
// Utility structs & functions (shared patterns with ws.rs, duplicated to
// avoid patching ws.rs and coupling to its internals)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, PartialEq, Eq)]
struct WsQueryParams {
    token: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
struct WsHistoryTurn {
    role: String,
    content: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq, Eq)]
struct WsPersistedHistory {
    version: u8,
    messages: Vec<WsHistoryTurn>,
}

fn normalize_ws_session_id(candidate: Option<&str>) -> Option<String> {
    let raw = candidate?.trim();
    if raw.is_empty() || raw.len() > MAX_WS_SESSION_ID_LEN {
        return None;
    }
    if raw
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Some(raw.to_string());
    }
    None
}

fn parse_ws_query_params(raw_query: Option<&str>) -> WsQueryParams {
    let Some(query) = raw_query else {
        return WsQueryParams::default();
    };
    let mut params = WsQueryParams::default();
    for kv in query.split('&') {
        let mut parts = kv.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim();
        let value = parts.next().unwrap_or("").trim();
        if value.is_empty() {
            continue;
        }
        match key {
            "token" if params.token.is_none() => {
                params.token = Some(value.to_string());
            }
            "session_id" if params.session_id.is_none() => {
                params.session_id = normalize_ws_session_id(Some(value));
            }
            _ => {}
        }
    }
    params
}

fn ws_history_memory_key(session_id: &str) -> String {
    format!("{WS_HISTORY_MEMORY_KEY_PREFIX}:{session_id}")
}

fn ws_history_turns_from_chat(history: &[ChatMessage]) -> Vec<WsHistoryTurn> {
    let mut turns = history
        .iter()
        .filter_map(|msg| match msg.role.as_str() {
            "user" | "assistant" => {
                let content = msg.content.trim();
                if content.is_empty() {
                    None
                } else {
                    Some(WsHistoryTurn {
                        role: msg.role.clone(),
                        content: content.to_string(),
                    })
                }
            }
            _ => None,
        })
        .collect::<Vec<_>>();

    if turns.len() > MAX_WS_PERSISTED_TURNS {
        let keep_from = turns.len().saturating_sub(MAX_WS_PERSISTED_TURNS);
        turns.drain(0..keep_from);
    }
    turns
}

fn restore_chat_history(system_prompt: &str, turns: &[WsHistoryTurn]) -> Vec<ChatMessage> {
    let mut history = vec![ChatMessage::system(system_prompt)];
    for turn in turns {
        match turn.role.as_str() {
            "user" => history.push(ChatMessage::user(&turn.content)),
            "assistant" => history.push(ChatMessage::assistant(&turn.content)),
            _ => {}
        }
    }
    history
}

async fn load_ws_history(
    state: &AppState,
    session_id: &str,
    system_prompt: &str,
) -> Vec<ChatMessage> {
    let key = ws_history_memory_key(session_id);
    let Some(entry) = state.mem.get(&key).await.ok().flatten() else {
        return vec![ChatMessage::system(system_prompt)];
    };

    let parsed = serde_json::from_str::<WsPersistedHistory>(&entry.content)
        .map(|history| history.messages)
        .or_else(|_| serde_json::from_str::<Vec<WsHistoryTurn>>(&entry.content));

    match parsed {
        Ok(turns) => restore_chat_history(system_prompt, &turns),
        Err(err) => {
            tracing::warn!(
                "Failed to parse persisted ws_stream history for session {}: {}",
                session_id,
                err
            );
            vec![ChatMessage::system(system_prompt)]
        }
    }
}

async fn persist_ws_history(state: &AppState, session_id: &str, history: &[ChatMessage]) {
    let payload = WsPersistedHistory {
        version: 1,
        messages: ws_history_turns_from_chat(history),
    };
    let serialized = match serde_json::to_string(&payload) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Failed to serialize ws_stream history for session {}: {}",
                session_id,
                err
            );
            return;
        }
    };

    let key = ws_history_memory_key(session_id);
    if let Err(err) = state
        .mem
        .store(
            &key,
            &serialized,
            MemoryCategory::Conversation,
            Some(session_id),
        )
        .await
    {
        tracing::warn!(
            "Failed to persist ws_stream history for session {}: {}",
            session_id,
            err
        );
    }
}

fn extract_ws_bearer_token(headers: &HeaderMap, query_token: Option<&str>) -> Option<String> {
    if let Some(auth_header) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
    {
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            if !token.trim().is_empty() {
                return Some(token.trim().to_string());
            }
        }
    }

    if let Some(offered) = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
    {
        for protocol in offered.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if let Some(token) = protocol.strip_prefix("bearer.") {
                if !token.trim().is_empty() {
                    return Some(token.trim().to_string());
                }
            }
        }
    }

    query_token
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
}

fn build_ws_system_prompt(
    config: &crate::config::Config,
    model: &str,
    tools_registry: &[Box<dyn crate::tools::Tool>],
    native_tools: bool,
) -> String {
    let mut tool_specs: Vec<crate::tools::ToolSpec> =
        tools_registry.iter().map(|tool| tool.spec()).collect();
    tool_specs.sort_by(|a, b| a.name.cmp(&b.name));

    let tool_descs: Vec<(&str, &str)> = tool_specs
        .iter()
        .map(|spec| (spec.name.as_str(), spec.description.as_str()))
        .collect();

    let bootstrap_max_chars = if config.agent.compact_context {
        Some(6000)
    } else {
        None
    };

    let mut prompt = crate::channels::build_system_prompt_with_mode(
        &config.workspace_dir,
        model,
        &tool_descs,
        &[],
        Some(&config.identity),
        bootstrap_max_chars,
        native_tools,
        config.skills.prompt_injection_mode,
    );
    if !native_tools {
        prompt.push_str(&build_tool_instructions_from_specs(&tool_specs));
    }
    prompt.push_str(&build_shell_policy_instructions(&config.autonomy));

    prompt
}

fn refresh_ws_history_system_prompt_datetime(history: &mut [ChatMessage]) {
    if let Some(system_message) = history.first_mut() {
        if system_message.role == "system" {
            crate::agent::prompt::refresh_prompt_datetime(&mut system_message.content);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WsAuthRejection {
    MissingPairingToken,
    NonLocalWithoutAuthLayer,
}

fn evaluate_ws_auth(
    pairing_required: bool,
    is_loopback_request: bool,
    has_valid_pairing_token: bool,
) -> Option<WsAuthRejection> {
    if pairing_required {
        return (!has_valid_pairing_token).then_some(WsAuthRejection::MissingPairingToken);
    }
    if !is_loopback_request && !has_valid_pairing_token {
        return Some(WsAuthRejection::NonLocalWithoutAuthLayer);
    }
    None
}

// ---------------------------------------------------------------------------
// Sentinel parser — converts on_delta strings to structured WS messages
// ---------------------------------------------------------------------------

/// Parse an on_delta string into a structured JSON WebSocket message.
///
/// The tool loop already emits these sentinels via `on_delta`:
///   - `DRAFT_CLEAR_SENTINEL`          → `{"type":"clear"}`
///   - `DRAFT_PROGRESS_SENTINEL`       → `{"type":"status","content":"..."}`
///   - `DRAFT_PROGRESS_BLOCK_SENTINEL` → `{"type":"tool_progress","content":"..."}`
///   - plain text                      → `{"type":"chunk","content":"..."}`
fn parse_delta_sentinel(delta: &str) -> serde_json::Value {
    if delta == DRAFT_CLEAR_SENTINEL {
        json!({"type": "clear"})
    } else if let Some(content) = delta.strip_prefix(DRAFT_PROGRESS_SENTINEL) {
        json!({"type": "status", "content": content})
    } else if let Some(content) = delta.strip_prefix(DRAFT_PROGRESS_BLOCK_SENTINEL) {
        json!({"type": "tool_progress", "content": content})
    } else {
        json!({"type": "chunk", "content": delta})
    }
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

/// GET /ws/stream — Streaming WebSocket upgrade for agent chat
pub async fn handle_ws_stream(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let query_params = parse_ws_query_params(query.as_deref());
    let token =
        extract_ws_bearer_token(&headers, query_params.token.as_deref()).unwrap_or_default();
    let has_valid_pairing_token = !token.is_empty() && state.pairing.is_authenticated(&token);
    let is_loopback_request =
        super::is_loopback_request(Some(peer_addr), &headers, state.trust_forwarded_headers);

    match evaluate_ws_auth(
        state.pairing.require_pairing(),
        is_loopback_request,
        has_valid_pairing_token,
    ) {
        Some(WsAuthRejection::MissingPairingToken) => {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "Unauthorized — provide Authorization: Bearer <token>, Sec-WebSocket-Protocol: bearer.<token>, or ?token=<token>",
            )
                .into_response();
        }
        Some(WsAuthRejection::NonLocalWithoutAuthLayer) => {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "Unauthorized — enable gateway pairing or provide a valid paired bearer token for non-local /ws/stream access",
            )
                .into_response();
        }
        None => {}
    }

    let session_id = query_params
        .session_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    ws.on_upgrade(move |socket| handle_socket(socket, state, session_id))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: AppState, session_id: String) {
    // Build system prompt once for the session
    let system_prompt = {
        let config_guard = state.config.lock();
        build_ws_system_prompt(
            &config_guard,
            &state.model,
            state.tools_registry_exec.as_ref(),
            state.provider.supports_native_tools(),
        )
    };

    // Restore persisted history and replay to the client
    let mut history = load_ws_history(&state, &session_id, &system_prompt).await;
    let persisted_turns = ws_history_turns_from_chat(&history);
    let history_payload = json!({
        "type": "history",
        "session_id": session_id.as_str(),
        "messages": persisted_turns,
    });
    if socket
        .send(Message::Text(history_payload.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    while let Some(msg) = socket.recv().await {
        let msg = match msg {
            Ok(Message::Text(text)) => text,
            Ok(Message::Close(_)) | Err(_) => break,
            _ => continue,
        };

        // Parse incoming message
        let parsed: serde_json::Value = match serde_json::from_str(&msg) {
            Ok(v) => v,
            Err(_) => {
                let err = json!({"type": "error", "message": "Invalid JSON"});
                let _ = socket.send(Message::Text(err.to_string().into())).await;
                continue;
            }
        };

        let msg_type = parsed["type"].as_str().unwrap_or("");
        if msg_type != "message" {
            continue;
        }

        let content = parsed["content"].as_str().unwrap_or("").to_string();
        if content.is_empty() {
            continue;
        }

        // Security: perplexity filter
        let perplexity_cfg = { state.config.lock().security.perplexity_filter.clone() };
        if let Some(assessment) =
            crate::security::detect_adversarial_suffix(&content, &perplexity_cfg)
        {
            let err = json!({
                "type": "error",
                "message": format!(
                    "Input blocked by security.perplexity_filter: perplexity={:.2} (threshold {:.2}), symbol_ratio={:.2} (threshold {:.2}), suspicious_tokens={}.",
                    assessment.perplexity,
                    perplexity_cfg.perplexity_threshold,
                    assessment.symbol_ratio,
                    perplexity_cfg.symbol_ratio_threshold,
                    assessment.suspicious_token_count
                ),
            });
            let _ = socket.send(Message::Text(err.to_string().into())).await;
            continue;
        }

        // Refresh datetime in system prompt
        refresh_ws_history_system_prompt_datetime(&mut history);

        // Add user message to history and persist
        history.push(ChatMessage::user(&content));
        persist_ws_history(&state, &session_id, &history).await;

        // Get provider info for events
        let provider_label = state
            .config
            .lock()
            .default_provider
            .clone()
            .unwrap_or_else(|| "unknown".to_string());

        // Broadcast agent_start event
        let _ = state.event_tx.send(json!({
            "type": "agent_start",
            "provider": &provider_label,
            "model": &state.model,
        }));

        // Create on_delta streaming channel.
        // Pattern follows channels/mod.rs: spawn the delta reader, run the
        // tool loop inline so references to AppState work without 'static.
        let (delta_tx, mut delta_rx) = tokio::sync::mpsc::channel::<String>(64);

        // Spawn delta reader — forwards on_delta events to the WebSocket.
        // Uses a shared socket via Arc<Mutex> so the reader can write
        // concurrently with the main loop waiting below.
        let socket_tx = std::sync::Arc::new(tokio::sync::Mutex::new(socket));
        let socket_reader = socket_tx.clone();
        let delta_forwarder = tokio::spawn(async move {
            while let Some(delta) = delta_rx.recv().await {
                let ws_msg = parse_delta_sentinel(&delta);
                let text = serde_json::to_string(&ws_msg).unwrap_or_default();
                let mut sock = socket_reader.lock().await;
                if sock.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        });

        // Run tool loop inline — uses references from AppState directly.
        // The history includes all prior turns so the agent has full context.
        let result = crate::agent::run_tool_call_loop(
            state.provider.as_ref(),
            &mut history,
            state.tools_registry_exec.as_ref(),
            state.observer.as_ref(),
            &provider_label,
            &state.model,
            state.temperature,
            true,  // silent
            None,  // approval
            "ws_stream",
            &state.multimodal,
            state.max_tool_iterations,
            None,              // cancellation_token
            Some(delta_tx),    // on_delta — dropped when loop returns
            None,              // hooks
            &[],               // excluded_tools
        )
        .await;

        // Wait for the delta forwarder to drain all remaining messages.
        let _ = delta_forwarder.await;

        // Reclaim the socket from the Arc<Mutex>.
        socket = std::sync::Arc::try_unwrap(socket_tx)
            .expect("delta_forwarder should have completed")
            .into_inner();

        match result {
            Ok(response) => {
                // run_tool_call_loop already pushed the assistant response to history
                // (loop_.rs line 1846). Just persist the updated history.
                persist_ws_history(&state, &session_id, &history).await;

                // Send full response (may contain [IMAGE:...] markers, XML tags, etc.)
                let done = json!({
                    "type": "done",
                    "full_response": response,
                });
                let _ = socket.send(Message::Text(done.to_string().into())).await;

                // Broadcast agent_end event
                let _ = state.event_tx.send(json!({
                    "type": "agent_end",
                    "provider": &provider_label,
                    "model": &state.model,
                }));
            }
            Err(e) => {
                let sanitized = crate::providers::sanitize_api_error(&e.to_string());
                let err = json!({
                    "type": "error",
                    "message": sanitized,
                });
                let _ = socket.send(Message::Text(err.to_string().into())).await;

                let _ = state.event_tx.send(json!({
                    "type": "error",
                    "component": "ws_stream",
                    "message": sanitized,
                }));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    // --- parse_delta_sentinel ---

    #[test]
    fn parse_delta_sentinel_clear() {
        let msg = parse_delta_sentinel(DRAFT_CLEAR_SENTINEL);
        assert_eq!(msg["type"], "clear");
    }

    #[test]
    fn parse_delta_sentinel_progress() {
        let msg = parse_delta_sentinel(&format!("{DRAFT_PROGRESS_SENTINEL}🤔 Thinking..."));
        assert_eq!(msg["type"], "status");
        assert_eq!(msg["content"], "🤔 Thinking...");
    }

    #[test]
    fn parse_delta_sentinel_progress_block() {
        let msg = parse_delta_sentinel(&format!("{DRAFT_PROGRESS_BLOCK_SENTINEL}🔧 shell ⏳"));
        assert_eq!(msg["type"], "tool_progress");
        assert_eq!(msg["content"], "🔧 shell ⏳");
    }

    #[test]
    fn parse_delta_sentinel_plain_text() {
        let msg = parse_delta_sentinel("Hello, this is the answer");
        assert_eq!(msg["type"], "chunk");
        assert_eq!(msg["content"], "Hello, this is the answer");
    }

    #[test]
    fn parse_delta_sentinel_empty() {
        let msg = parse_delta_sentinel("");
        assert_eq!(msg["type"], "chunk");
        assert_eq!(msg["content"], "");
    }

    // --- Duplicated utility tests ---

    #[test]
    fn normalize_ws_session_id_accepts_valid() {
        assert_eq!(
            normalize_ws_session_id(Some("sess-123_abc")),
            Some("sess-123_abc".to_string())
        );
    }

    #[test]
    fn normalize_ws_session_id_rejects_path_traversal() {
        assert!(normalize_ws_session_id(Some("../../etc/passwd")).is_none());
    }

    #[test]
    fn normalize_ws_session_id_rejects_empty() {
        assert!(normalize_ws_session_id(Some("")).is_none());
        assert!(normalize_ws_session_id(None).is_none());
    }

    #[test]
    fn parse_ws_query_params_reads_session_and_token() {
        let p = parse_ws_query_params(Some("session_id=s1&token=t1"));
        assert_eq!(p.session_id.as_deref(), Some("s1"));
        assert_eq!(p.token.as_deref(), Some("t1"));
    }

    #[test]
    fn ws_history_turns_filters_system_and_tool_messages() {
        let history = vec![
            ChatMessage::system("sys"),
            ChatMessage::user("hello"),
            ChatMessage {
                role: "tool".to_string(),
                content: "ignored".to_string(),
            },
            ChatMessage::assistant("world"),
        ];
        let turns = ws_history_turns_from_chat(&history);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].content, "hello");
        assert_eq!(turns[1].content, "world");
    }

    #[test]
    fn restore_chat_history_prepends_system() {
        let turns = vec![WsHistoryTurn {
            role: "user".to_string(),
            content: "hi".to_string(),
        }];
        let restored = restore_chat_history("system prompt", &turns);
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].role, "system");
        assert_eq!(restored[1].role, "user");
    }

    #[test]
    fn evaluate_ws_auth_requires_token_when_pairing_enabled() {
        assert_eq!(
            evaluate_ws_auth(true, true, false),
            Some(WsAuthRejection::MissingPairingToken)
        );
        assert_eq!(evaluate_ws_auth(true, false, true), None);
    }

    #[test]
    fn evaluate_ws_auth_allows_loopback_when_pairing_disabled() {
        assert_eq!(evaluate_ws_auth(false, true, false), None);
    }

    #[test]
    fn evaluate_ws_auth_rejects_public_without_auth() {
        assert_eq!(
            evaluate_ws_auth(false, false, false),
            Some(WsAuthRejection::NonLocalWithoutAuthLayer)
        );
    }

    #[test]
    fn extract_ws_bearer_token_prefers_auth_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer tok1"),
        );
        assert_eq!(
            extract_ws_bearer_token(&headers, Some("tok2")).as_deref(),
            Some("tok1")
        );
    }

    #[test]
    fn extract_ws_bearer_token_falls_back_to_query() {
        let headers = HeaderMap::new();
        assert_eq!(
            extract_ws_bearer_token(&headers, Some("qt")).as_deref(),
            Some("qt")
        );
    }

}
