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
//! {"type":"history","thread_id":"...","messages":[...]}
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
    build_tool_instructions, run_tool_call_loop, is_tool_loop_cancelled,
    DRAFT_CLEAR_SENTINEL,
};
use crate::memory::MemoryCategory;
use crate::providers::ChatMessage;
use crate::security::SecurityPolicy;
use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, RawQuery, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WS_CONVERSATION_HISTORY: usize = 50; // matches MAX_CHANNEL_HISTORY
const AUTOSAVE_MIN_MESSAGE_CHARS: usize = 20; // matches channels/mod.rs L114
const MAX_WS_SESSION_ID_LEN: usize = 128;

/// Estimated token threshold that triggers history trimming.
/// Matches native channel constant `CHANNEL_CONTEXT_TOKEN_ESTIMATE_LIMIT`.
const WS_CONTEXT_TOKEN_LIMIT: usize = 90_000;

/// Estimated token target after trimming.
/// Matches native channel constant `CHANNEL_CONTEXT_TOKEN_ESTIMATE_TARGET`.
const WS_CONTEXT_TOKEN_TARGET: usize = 80_000;

/// Minimum non-system messages to keep after trimming.
/// Matches native channel constant `CHANNEL_CONTEXT_MIN_KEEP_NON_SYSTEM_MESSAGES`.
const WS_CONTEXT_MIN_KEEP: usize = 10;

/// Maximum memory entries to recall for first-turn context enrichment.
const MEMORY_CONTEXT_MAX_ENTRIES: usize = 4;

/// Maximum characters per individual memory entry (truncated with "...").
const MEMORY_CONTEXT_ENTRY_MAX_CHARS: usize = 800;

/// Maximum total characters for the memory context block.
const MEMORY_CONTEXT_MAX_CHARS: usize = 4_000;

/// Base timeout for the tool loop in seconds.
const TOOL_LOOP_BASE_TIMEOUT_SECS: u64 = 300;

/// Maximum scaling factor for tool loop timeout based on max_tool_iterations.
const TOOL_LOOP_TIMEOUT_SCALE_CAP: u64 = 4;

// ---------------------------------------------------------------------------
// In-memory conversation cache (matches native channels' conversation_histories)
// ---------------------------------------------------------------------------

static WS_CONVERSATIONS: std::sync::LazyLock<StdMutex<HashMap<String, Vec<ChatMessage>>>> =
    std::sync::LazyLock::new(|| StdMutex::new(HashMap::new()));

fn append_ws_turn(thread_id: &str, turn: ChatMessage) {
    let mut histories = WS_CONVERSATIONS.lock().unwrap_or_else(|e| e.into_inner());
    let turns = histories.entry(thread_id.to_string()).or_default();
    turns.push(turn);
    while turns.len() > MAX_WS_CONVERSATION_HISTORY {
        turns.remove(0);
    }
}

fn load_ws_cached_history(thread_id: &str, system_prompt: &str) -> (Vec<ChatMessage>, bool) {
    let histories = WS_CONVERSATIONS.lock().unwrap_or_else(|e| e.into_inner());
    let had_prior = histories
        .get(thread_id)
        .is_some_and(|turns| !turns.is_empty());
    let mut history = vec![ChatMessage::system(system_prompt)];
    if let Some(turns) = histories.get(thread_id) {
        history.extend(turns.iter().cloned());
    }
    (history, had_prior)
}

fn ws_turns_from_cache(thread_id: &str) -> Vec<WsHistoryTurn> {
    let histories = WS_CONVERSATIONS.lock().unwrap_or_else(|e| e.into_inner());
    histories
        .get(thread_id)
        .map(|turns| {
            turns
                .iter()
                .filter(|m| m.role == "user" || m.role == "assistant")
                .filter(|m| !m.content.trim().is_empty())
                .map(|m| WsHistoryTurn {
                    role: m.role.clone(),
                    content: m.content.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn ws_conversation_memory_key(thread_id: &str) -> String {
    format!("clawrun_{}_{}", thread_id, Uuid::new_v4())
}

fn ws_assistant_memory_key(thread_id: &str) -> String {
    format!("assistant_resp_clawrun_{}_{}", thread_id, Uuid::new_v4())
}

// ---------------------------------------------------------------------------
// Utility structs & functions (shared patterns with ws.rs, duplicated to
// avoid patching ws.rs and coupling to its internals)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, PartialEq, Eq)]
struct WsQueryParams {
    token: Option<String>,
    thread_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
struct WsHistoryTurn {
    role: String,
    content: String,
}

fn normalize_ws_thread_id(candidate: Option<&str>) -> Option<String> {
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
            "thread_id" if params.thread_id.is_none() => {
                params.thread_id = normalize_ws_thread_id(Some(value));
            }
            _ => {}
        }
    }
    params
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
        prompt.push_str(&build_tool_instructions(tools_registry));
    }

    prompt
}

/// Estimate tokens for a single message.
/// Matches native channel formula: `(char_count + 2) / 3 + 4`.
fn estimated_message_tokens(message: &ChatMessage) -> usize {
    (message.content.chars().count().saturating_add(2) / 3).saturating_add(4)
}

/// Trim history to fit within the estimated token budget.
/// Drops the oldest non-system messages first, preserving at least
/// `WS_CONTEXT_MIN_KEEP` non-system messages.
/// Mirrors `trim_channel_prompt_history` from native channels.
fn trim_ws_history_to_budget(history: &mut Vec<ChatMessage>) {
    let mut total: usize = history.iter().map(estimated_message_tokens).sum();
    if total <= WS_CONTEXT_TOKEN_LIMIT {
        return;
    }

    loop {
        if total <= WS_CONTEXT_TOKEN_TARGET {
            break;
        }
        let non_system = history.iter().filter(|m| m.role != "system").count();
        if non_system <= WS_CONTEXT_MIN_KEEP {
            break;
        }
        let Some(idx) = history.iter().position(|m| m.role != "system") else {
            break;
        };
        let removed = history.remove(idx);
        total = total.saturating_sub(estimated_message_tokens(&removed));
    }
}

/// Truncate a string to `max_chars` and append "..." if truncated.
/// Mirrors `crate::util::truncate_with_ellipsis`: keeps first `max_chars`
/// characters, trims trailing whitespace, then appends "...".
fn truncate_with_ellipsis(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => {
            let truncated = &s[..idx];
            format!("{}...", truncated.trim_end())
        }
        None => s.to_string(),
    }
}

/// Check whether a memory entry should be skipped for context injection.
/// Mirrors `should_skip_memory_context_entry` from native channels.
fn should_skip_memory_entry(key: &str, content: &str) -> bool {
    let normalized = key.trim().to_ascii_lowercase();
    // Skip assistant autosave entries
    if normalized == "assistant_resp" || normalized.starts_with("assistant_resp_") {
        return true;
    }
    // Skip history blobs
    if normalized.ends_with("_history") {
        return true;
    }
    // Skip oversized entries
    content.chars().count() > MEMORY_CONTEXT_MAX_CHARS
}

/// Build memory context for the first turn of a new session.
/// Mirrors `build_memory_context` from native channels: uses `Memory::recall`,
/// filters by score and content, truncates entries, caps total output.
async fn build_first_turn_memory_context(
    state: &AppState,
    user_msg: &str,
    min_relevance_score: f64,
    thread_id: &str,
) -> String {
    // Fetch slightly more candidates than the max to allow for filtering
    let fetch_limit = MEMORY_CONTEXT_MAX_ENTRIES + 1;
    let entries = match state
        .mem
        .recall(user_msg, fetch_limit, Some(thread_id))
        .await
    {
        Ok(entries) => entries,
        Err(_) => return String::new(),
    };

    let mut context = String::new();
    let mut included = 0usize;
    let mut used_chars = 0usize;

    for entry in entries.iter().filter(|e| match e.score {
        Some(score) => score >= min_relevance_score,
        None => true, // keep entries without a score (e.g. non-vector backends)
    }) {
        if included >= MEMORY_CONTEXT_MAX_ENTRIES {
            break;
        }
        if should_skip_memory_entry(&entry.key, &entry.content) {
            continue;
        }

        let content = if entry.content.chars().count() > MEMORY_CONTEXT_ENTRY_MAX_CHARS {
            truncate_with_ellipsis(&entry.content, MEMORY_CONTEXT_ENTRY_MAX_CHARS)
        } else {
            entry.content.clone()
        };

        let line = format!("- {}: {}\n", entry.key, content);
        let line_chars = line.chars().count();
        if used_chars + line_chars > MEMORY_CONTEXT_MAX_CHARS {
            break;
        }

        if included == 0 {
            context.push_str("[Memory context]\n");
        }

        context.push_str(&line);
        used_chars += line_chars;
        included += 1;
    }

    if included > 0 {
        context.push('\n');
    }

    context
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
// Delta parser — converts on_delta strings to structured WS messages
// ---------------------------------------------------------------------------

/// Parse an on_delta string into a structured JSON WebSocket message.
///
/// The tool loop emits these via `on_delta`:
///   - `DRAFT_CLEAR_SENTINEL`        → `{"type":"clear"}`
///   - `🤔 Thinking...\n`            → `{"type":"status","content":"..."}`
///   - `💬 Got N tool call(s)...\n`   → `{"type":"status","content":"..."}`
///   - `⏳ tool_name: hint\n`         → `{"type":"tool_progress","content":"..."}`
///   - `✅ tool_name (Ns)\n`          → `{"type":"tool_progress","content":"..."}`
///   - `❌ tool_name (Ns)\n`          → `{"type":"tool_progress","content":"..."}`
///   - plain text                     → `{"type":"chunk","content":"..."}`
fn parse_delta_sentinel(delta: &str) -> serde_json::Value {
    if delta == DRAFT_CLEAR_SENTINEL {
        json!({"type": "clear"})
    } else {
        let trimmed = delta.trim_start();
        // Status indicators: 🤔 (U+1F914) and 💬 (U+1F4AC)
        if trimmed.starts_with('\u{1F914}') || trimmed.starts_with('\u{1F4AC}') {
            json!({"type": "status", "content": delta})
        }
        // Tool progress indicators: ⏳ (U+23F3), ✅ (U+2705), ❌ (U+274C)
        else if trimmed.starts_with('\u{23F3}') || trimmed.starts_with('\u{2705}') || trimmed.starts_with('\u{274C}') {
            json!({"type": "tool_progress", "content": delta})
        }
        else {
            json!({"type": "chunk", "content": delta})
        }
    }
}

// ---------------------------------------------------------------------------
// History enrichment — converts intermediate tool-loop messages to XML
// ---------------------------------------------------------------------------

/// Build an XML-enriched response string from intermediate tool-loop messages.
///
/// When the tool loop executes tools, `llm_history` accumulates intermediate
/// assistant messages (with tool calls / reasoning) and tool result messages.
/// This function converts those into XML tags that match the streaming format:
///   - `<thinking>reasoning</thinking>`
///   - `<tool_call name="tool_name">arguments_json</tool_call>`
///   - `<tool_result>output</tool_result>`
///
/// The final response text is wrapped in `<response>...</response>` when
/// intermediate content exists, producing a single coherent assistant message
/// that uses the same XML parsing path as live streaming on the client.
fn build_enriched_response(new_messages: &[ChatMessage], final_response: &str) -> String {
    if new_messages.is_empty() {
        return final_response.to_string();
    }

    // The last message from the tool loop is the final assistant response.
    // Everything before it is intermediate (tool calls + results).
    let intermediate = match new_messages.last() {
        Some(msg) if msg.role == "assistant" => &new_messages[..new_messages.len() - 1],
        _ => new_messages,
    };

    if intermediate.is_empty() {
        return final_response.to_string();
    }

    // Collect tool results by tool_call_id for pairing with native tool calls.
    // Also keep an ordered list for positional fallback (alias mode).
    let mut results_by_id = std::collections::HashMap::<String, String>::new();
    let mut results_ordered = Vec::<String>::new();
    for msg in intermediate.iter().filter(|m| m.role == "tool") {
        let (id, content) = match serde_json::from_str::<serde_json::Value>(&msg.content) {
            Ok(v) => (
                v["tool_call_id"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                v["content"]
                    .as_str()
                    .unwrap_or("completed")
                    .to_string(),
            ),
            Err(_) => (String::new(), msg.content.trim().to_string()),
        };
        if !id.is_empty() {
            results_by_id.insert(id, content.clone());
        }
        results_ordered.push(content);
    }

    let mut enriched = String::new();
    let mut result_cursor = 0usize;

    for msg in intermediate.iter().filter(|m| m.role == "assistant") {
        // Try native JSON format: {tool_calls:[...], reasoning_content, content}
        let native = serde_json::from_str::<serde_json::Value>(&msg.content)
            .ok()
            .filter(|v| v.get("tool_calls").is_some());

        if let Some(parsed) = native {
            // Reasoning
            if let Some(reasoning) = parsed["reasoning_content"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                enriched.push_str("<thinking>");
                enriched.push_str(reasoning);
                enriched.push_str("</thinking>\n");
            }

            // Tool calls, each followed by its paired result
            if let Some(calls) = parsed["tool_calls"].as_array() {
                for call in calls {
                    let name = call["name"].as_str().unwrap_or("unknown");
                    let args = call["arguments"].as_str().unwrap_or("{}");
                    enriched.push_str(&format!(
                        "<tool_call name=\"{name}\">{args}</tool_call>\n"
                    ));

                    // Pair by ID first, ordered fallback second
                    let output = call["id"]
                        .as_str()
                        .and_then(|id| results_by_id.get(id))
                        .or_else(|| results_ordered.get(result_cursor))
                        .map(String::as_str)
                        .unwrap_or("completed");
                    enriched.push_str(&format!("<tool_result>{output}</tool_result>\n"));
                    result_cursor += 1;
                }
            }
        } else {
            // Alias mode: content already has XML <tool_call> tags.
            // Insert <tool_result> after each </tool_call>.
            let content = &msg.content;
            let tag = "</tool_call>";
            let mut last = 0usize;
            for (pos, _) in content.match_indices(tag) {
                let end = pos + tag.len();
                enriched.push_str(&content[last..end]);
                enriched.push('\n');
                let output = results_ordered
                    .get(result_cursor)
                    .map(String::as_str)
                    .unwrap_or("completed");
                enriched.push_str(&format!("<tool_result>{output}</tool_result>\n"));
                result_cursor += 1;
                last = end;
            }
            if last < content.len() {
                enriched.push_str(&content[last..]);
            }
            enriched.push('\n');
        }
    }

    let enriched = enriched.trim();
    if enriched.is_empty() {
        final_response.to_string()
    } else {
        format!("{enriched}\n<response>{final_response}</response>")
    }
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

/// Detect whether a request originates from the loopback interface.
/// Checks the peer socket address and, if `trust_forwarded` is enabled,
/// the `X-Forwarded-For` / `X-Real-IP` headers.
fn is_ws_loopback(peer: Option<SocketAddr>, headers: &HeaderMap, trust_forwarded: bool) -> bool {
    if let Some(addr) = peer {
        if addr.ip().is_loopback() {
            return true;
        }
    }
    if trust_forwarded {
        if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            let first_ip = xff.split(',').next().unwrap_or("").trim();
            if first_ip == "127.0.0.1" || first_ip == "::1" {
                return true;
            }
        }
        if let Some(real_ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
            let trimmed = real_ip.trim();
            if trimmed == "127.0.0.1" || trimmed == "::1" {
                return true;
            }
        }
    }
    false
}

/// GET /ws/clawrun — Streaming WebSocket upgrade for agent chat
pub async fn handle_ws_clawrun(
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
        is_ws_loopback(Some(peer_addr), &headers, state.trust_forwarded_headers);

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
                "Unauthorized — enable gateway pairing or provide a valid paired bearer token for non-local /ws/clawrun access",
            )
                .into_response();
        }
        None => {}
    }

    let thread_id = query_params
        .thread_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    ws.on_upgrade(move |socket| handle_socket(socket, state, thread_id))
        .into_response()
}

async fn handle_socket(socket: WebSocket, state: AppState, thread_id: String) {
    // Build executable tools registry from config (same as channels do).
    // AppState only holds ToolSpec (metadata), so we need to create the
    // actual executable tools here.
    let (tools_registry, system_prompt, max_tool_iterations, excluded_tools, dedup_exempt_tools) = {
        let config = state.config.lock().clone();
        let security = Arc::new(SecurityPolicy::from_config(
            &config.autonomy,
            &config.workspace_dir,
        ));
        let runtime: Arc<dyn crate::runtime::RuntimeAdapter> = match crate::runtime::create_runtime(&config.runtime) {
            Ok(rt) => Arc::from(rt),
            Err(e) => {
                tracing::error!("ws_clawrun: failed to create runtime: {e}");
                return;
            }
        };
        let (composio_key, composio_entity_id) = if config.composio.enabled {
            (
                config.composio.api_key.as_deref(),
                Some(config.composio.entity_id.as_str()),
            )
        } else {
            (None, None)
        };
        let (tools, _delegate_handle) = crate::tools::all_tools_with_runtime(
            Arc::new(config.clone()),
            &security,
            runtime,
            Arc::clone(&state.mem),
            composio_key,
            composio_entity_id,
            &config.browser,
            &config.http_request,
            &config.web_fetch,
            &config.workspace_dir,
            &config.agents,
            config.api_key.as_deref(),
            &config,
        );
        let native_tools = state.provider.supports_native_tools();
        let prompt = build_ws_system_prompt(&config, &state.model, &tools, native_tools);
        let max_iters = config.agent.max_tool_iterations;
        let excluded = config.autonomy.non_cli_excluded_tools.clone();
        let dedup_exempt = config.agent.tool_call_dedup_exempt.clone();
        (tools, prompt, max_iters, excluded, dedup_exempt)
    };

    // Split the socket into sender/receiver halves for concurrent read/write.
    let (ws_sender, mut ws_receiver) = socket.split();
    let ws_sender = Arc::new(tokio::sync::Mutex::new(ws_sender));

    // Load history from in-memory cache (like native channels' conversation_histories)
    let (mut history, mut had_prior_turns) =
        load_ws_cached_history(&thread_id, &system_prompt);
    tracing::info!(
        "ws_clawrun: thread={} cached_history_len={} had_prior={}",
        thread_id,
        history.len(),
        had_prior_turns,
    );

    // Send cached history to client
    let persisted_turns = ws_turns_from_cache(&thread_id);
    let history_payload = json!({
        "type": "history",
        "thread_id": thread_id.as_str(),
        "messages": persisted_turns,
    });
    {
        let mut sender = ws_sender.lock().await;
        if sender
            .send(Message::Text(history_payload.to_string().into()))
            .await
            .is_err()
        {
            return;
        }
    }

    while let Some(msg) = ws_receiver.next().await {
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
                let _ = ws_sender.lock().await.send(Message::Text(err.to_string().into())).await;
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

        // Add to in-memory cache (like append_sender_turn)
        append_ws_turn(&thread_id, ChatMessage::user(&content));

        // Add to local history for this request
        history.push(ChatMessage::user(&content));

        // Auto-save individual user message (native channel pattern)
        if state.auto_save && content.chars().count() >= AUTOSAVE_MIN_MESSAGE_CHARS {
            let user_key = ws_conversation_memory_key(&thread_id);
            let _ = state
                .mem
                .store(
                    &user_key,
                    &content,
                    MemoryCategory::Conversation,
                    Some(&thread_id),
                )
                .await;
        }

        // Build the LLM history as a separate copy so enrichment (memory
        // context, timestamps) never pollutes the persisted history.
        // This mirrors native channels which enrich `prior_turns` (a copy)
        // while persisting only raw content.
        let mut llm_history = history.clone();

        // First turn: enrich with recalled memories (like native channels)
        if !had_prior_turns {
            let min_relevance = state.config.lock().memory.min_relevance_score;
            let mem_context = build_first_turn_memory_context(
                &state,
                &content,
                min_relevance,
                &thread_id,
            )
            .await;
            if !mem_context.is_empty() {
                if let Some(last) = llm_history.last_mut() {
                    if last.role == "user" {
                        last.content = format!("{mem_context}{}", last.content);
                    }
                }
            }
            had_prior_turns = true;
        }

        // Trim LLM history to fit within context window budget
        trim_ws_history_to_budget(&mut llm_history);

        // Capture length before tool loop so we can extract new messages after
        let llm_len_before_loop = llm_history.len();

        // Get provider info and multimodal config
        let (provider_label, timeout_secs, multimodal_config) = {
            let config = state.config.lock();
            let label = config
                .default_provider
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            let scale = (max_tool_iterations as u64)
                .max(1)
                .min(TOOL_LOOP_TIMEOUT_SCALE_CAP);
            let timeout = TOOL_LOOP_BASE_TIMEOUT_SECS.saturating_mul(scale);
            let multimodal = config.multimodal.clone();
            (label, timeout, multimodal)
        };

        // Configured hooks
        let configured_hooks: Option<Arc<crate::hooks::HookRunner>> = {
            let config = state.config.lock();
            if config.hooks.enabled {
                let mut runner = crate::hooks::HookRunner::new();
                if config.hooks.builtin.command_logger {
                    runner.register(Box::new(crate::hooks::builtin::CommandLoggerHook::new()));
                }
                if config.hooks.builtin.webhook_audit.enabled {
                    runner.register(Box::new(crate::hooks::builtin::WebhookAuditHook::new(
                        config.hooks.builtin.webhook_audit.clone(),
                    )));
                }
                Some(Arc::new(runner))
            } else {
                None
            }
        };

        // Broadcast agent_start event
        let _ = state.event_tx.send(json!({
            "type": "agent_start",
            "provider": &provider_label,
            "model": &state.model,
        }));

        // ── Cancellation token ──
        // Cancelled when the WebSocket disconnects during the tool loop.
        let cancellation_token = CancellationToken::new();

        // Create on_delta streaming channel.
        let (delta_tx, mut delta_rx) = tokio::sync::mpsc::channel::<String>(64);

        // Spawn delta forwarder — forwards on_delta events to the WebSocket.
        let sender_for_delta = ws_sender.clone();
        let delta_forwarder = tokio::spawn(async move {
            while let Some(delta) = delta_rx.recv().await {
                let ws_msg = parse_delta_sentinel(&delta);
                let text = serde_json::to_string(&ws_msg).unwrap_or_default();
                let mut sender = sender_for_delta.lock().await;
                if sender.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        });

        // Spawn reader task — reads from the WebSocket stream during the tool
        // loop for disconnect detection. Cancels the tool loop if the client
        // disconnects.
        let cancellation_for_reader = cancellation_token.clone();
        let reader_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Stop when the tool loop completes (or is cancelled)
                    () = cancellation_for_reader.cancelled() => break,
                    msg = ws_receiver.next() => {
                        match msg {
                            Some(Ok(Message::Text(_))) => {
                                // Ignore messages during tool loop
                            }
                            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                                // WebSocket disconnected — cancel the in-flight tool loop
                                cancellation_for_reader.cancel();
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }
            // Return the receiver half so we can reuse it
            ws_receiver
        });

        // Run tool loop — matches native channel calling convention.
        let result = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            run_tool_call_loop(
                state.provider.as_ref(),
                &mut llm_history,
                &tools_registry,
                state.observer.as_ref(),
                &provider_label,
                &state.model,
                state.temperature,
                true,                                   // silent
                None,                                   // approval (full autonomy)
                "ws_clawrun",
                &multimodal_config,
                max_tool_iterations,
                Some(cancellation_token.clone()),        // cancellation token
                Some(delta_tx),                          // on_delta
                configured_hooks.as_deref(),             // hooks
                &excluded_tools,                         // excluded tools
                &dedup_exempt_tools,                     // dedup exempt tools
            ),
        )
        .await;

        // Wait for the delta forwarder to drain.
        let _ = delta_forwarder.await;

        // Stop the reader task and reclaim the receiver half of the socket.
        cancellation_token.cancel();
        ws_receiver = match reader_task.await {
            Ok(receiver) => receiver,
            Err(_) => {
                tracing::error!(
                    "ws_clawrun: reader task panicked — aborting thread {}",
                    thread_id
                );
                return;
            }
        };

        // Unwrap timeout: Elapsed → error, Ok(inner) → tool loop result
        let result = match result {
            Ok(inner) => inner,
            Err(_) => {
                // Add failure marker to in-memory cache
                append_ws_turn(
                    &thread_id,
                    ChatMessage::assistant("[Task timed out — not continuing this request]"),
                );
                history.push(ChatMessage::assistant(
                    "[Task timed out — not continuing this request]",
                ));

                let err = json!({
                    "type": "error",
                    "message": format!("Tool loop timed out after {}s", timeout_secs),
                });
                let _ = ws_sender.lock().await.send(Message::Text(err.to_string().into())).await;
                continue;
            }
        };

        match result {
            Ok(response) => {
                // Build an XML-enriched assistant message from intermediate
                // tool-loop messages so history replay uses the same XML
                // parsing path as live streaming.
                let new_msgs = &llm_history[llm_len_before_loop..];
                let enriched = build_enriched_response(new_msgs, &response);

                // Add to in-memory cache (like append_sender_turn)
                append_ws_turn(&thread_id, ChatMessage::assistant(&enriched));

                // Add to local history
                history.push(ChatMessage::assistant(&enriched));

                // Auto-save individual assistant response (native channel pattern)
                if state.auto_save
                    && response.chars().count() >= AUTOSAVE_MIN_MESSAGE_CHARS
                {
                    let assistant_key = ws_assistant_memory_key(&thread_id);
                    let _ = state
                        .mem
                        .store(
                            &assistant_key,
                            &response,
                            MemoryCategory::Conversation,
                            None,
                        )
                        .await;
                }

                // Send full response (may contain [IMAGE:...] markers, XML tags, etc.)
                let done = json!({
                    "type": "done",
                    "full_response": response,
                });
                let _ = ws_sender.lock().await.send(Message::Text(done.to_string().into())).await;

                // Broadcast agent_end event
                let _ = state.event_tx.send(json!({
                    "type": "agent_end",
                    "provider": &provider_label,
                    "model": &state.model,
                }));
            }
            Err(e) => {
                // Check if the tool loop was cancelled (WS disconnect)
                if is_tool_loop_cancelled(&e) {
                    tracing::info!(
                        "ws_clawrun: tool loop cancelled (client disconnected) — thread {}",
                        thread_id
                    );
                    return;
                }

                // Add failure marker to in-memory cache
                append_ws_turn(
                    &thread_id,
                    ChatMessage::assistant("[Task failed — not continuing this request]"),
                );
                history.push(ChatMessage::assistant(
                    "[Task failed — not continuing this request]",
                ));

                let sanitized = crate::providers::sanitize_api_error(&e.to_string());
                let err = json!({
                    "type": "error",
                    "message": sanitized,
                });
                let _ = ws_sender.lock().await.send(Message::Text(err.to_string().into())).await;

                let _ = state.event_tx.send(json!({
                    "type": "error",
                    "component": "ws_clawrun",
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

    #[test]
    fn parse_delta_sentinel_thinking_status() {
        let msg = parse_delta_sentinel("🤔 Thinking...\n");
        assert_eq!(msg["type"], "status");
        assert_eq!(msg["content"], "🤔 Thinking...\n");
    }

    #[test]
    fn parse_delta_sentinel_thinking_round_status() {
        let msg = parse_delta_sentinel("🤔 Thinking (round 3)...\n");
        assert_eq!(msg["type"], "status");
        assert_eq!(msg["content"], "🤔 Thinking (round 3)...\n");
    }

    #[test]
    fn parse_delta_sentinel_got_tool_calls_status() {
        let msg = parse_delta_sentinel("💬 Got 2 tool call(s) (1.5s)\n");
        assert_eq!(msg["type"], "status");
        assert_eq!(msg["content"], "💬 Got 2 tool call(s) (1.5s)\n");
    }

    #[test]
    fn parse_delta_sentinel_tool_pending() {
        let msg = parse_delta_sentinel("⏳ shell\n");
        assert_eq!(msg["type"], "tool_progress");
        assert_eq!(msg["content"], "⏳ shell\n");
    }

    #[test]
    fn parse_delta_sentinel_tool_pending_with_hint() {
        let msg = parse_delta_sentinel("⏳ shell: ls -la\n");
        assert_eq!(msg["type"], "tool_progress");
        assert_eq!(msg["content"], "⏳ shell: ls -la\n");
    }

    #[test]
    fn parse_delta_sentinel_tool_success() {
        let msg = parse_delta_sentinel("✅ shell (2s)\n");
        assert_eq!(msg["type"], "tool_progress");
        assert_eq!(msg["content"], "✅ shell (2s)\n");
    }

    #[test]
    fn parse_delta_sentinel_tool_failure() {
        let msg = parse_delta_sentinel("❌ shell (3s)\n");
        assert_eq!(msg["type"], "tool_progress");
        assert_eq!(msg["content"], "❌ shell (3s)\n");
    }

    // --- Duplicated utility tests ---

    #[test]
    fn normalize_ws_thread_id_accepts_valid() {
        assert_eq!(
            normalize_ws_thread_id(Some("sess-123_abc")),
            Some("sess-123_abc".to_string())
        );
    }

    #[test]
    fn normalize_ws_thread_id_rejects_path_traversal() {
        assert!(normalize_ws_thread_id(Some("../../etc/passwd")).is_none());
    }

    #[test]
    fn normalize_ws_thread_id_rejects_empty() {
        assert!(normalize_ws_thread_id(Some("")).is_none());
        assert!(normalize_ws_thread_id(None).is_none());
    }

    #[test]
    fn parse_ws_query_params_reads_session_and_token() {
        let p = parse_ws_query_params(Some("thread_id=s1&token=t1"));
        assert_eq!(p.thread_id.as_deref(), Some("s1"));
        assert_eq!(p.token.as_deref(), Some("t1"));
    }

    // --- in-memory conversation cache ---

    #[test]
    fn append_ws_turn_respects_max_history_cap() {
        // Use a unique session id to avoid interference from other tests
        let sid = format!("test_cap_{}", Uuid::new_v4());
        // Fill beyond MAX_WS_CONVERSATION_HISTORY
        for i in 0..(MAX_WS_CONVERSATION_HISTORY + 10) {
            append_ws_turn(&sid, ChatMessage::user(&format!("msg {i}")));
        }
        let histories = WS_CONVERSATIONS.lock().unwrap();
        let turns = histories.get(&sid).unwrap();
        assert_eq!(turns.len(), MAX_WS_CONVERSATION_HISTORY);
        // Oldest messages should have been evicted; newest should remain
        assert!(turns.last().unwrap().content.contains(&format!("msg {}", MAX_WS_CONVERSATION_HISTORY + 9)));
    }

    #[test]
    fn ws_conversation_memory_key_format() {
        let key = ws_conversation_memory_key("sess-1");
        assert!(key.starts_with("clawrun_sess-1_"));
        // Each call produces a unique key (UUID suffix)
        let key2 = ws_conversation_memory_key("sess-1");
        assert_ne!(key, key2);
    }

    #[test]
    fn ws_assistant_memory_key_format() {
        let key = ws_assistant_memory_key("sess-2");
        assert!(key.starts_with("assistant_resp_clawrun_sess-2_"));
        let key2 = ws_assistant_memory_key("sess-2");
        assert_ne!(key, key2);
    }

    #[test]
    fn load_ws_cached_history_empty_then_populated() {
        let sid = format!("test_load_{}", Uuid::new_v4());

        // Empty session → had_prior = false, history = [system]
        let (history, had_prior) = load_ws_cached_history(&sid, "sys prompt");
        assert!(!had_prior);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].role, "system");

        // Add a turn
        append_ws_turn(&sid, ChatMessage::user("hello"));

        // Now → had_prior = true, history = [system, user]
        let (history, had_prior) = load_ws_cached_history(&sid, "sys prompt");
        assert!(had_prior);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, "system");
        assert_eq!(history[1].role, "user");
        assert_eq!(history[1].content, "hello");
    }

    #[test]
    fn ws_turns_from_cache_filters_system_and_empty() {
        let sid = format!("test_turns_{}", Uuid::new_v4());
        append_ws_turn(&sid, ChatMessage::user("hello"));
        append_ws_turn(&sid, ChatMessage::assistant(""));
        append_ws_turn(&sid, ChatMessage::assistant("world"));

        let turns = ws_turns_from_cache(&sid);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].role, "user");
        assert_eq!(turns[0].content, "hello");
        assert_eq!(turns[1].role, "assistant");
        assert_eq!(turns[1].content, "world");
    }

    // --- build_enriched_response ---

    #[test]
    fn build_enriched_response_with_native_tool_calls() {
        let messages = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: r#"{"tool_calls":[{"id":"c1","name":"shell","arguments":"{\"cmd\":\"ls\"}"}],"reasoning_content":"thinking about files","content":""}"#.to_string(),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: r#"{"tool_call_id":"c1","content":"file1.txt\nfile2.txt"}"#.to_string(),
            },
            ChatMessage::assistant("Here are the files."),
        ];
        let result = build_enriched_response(&messages, "Here are the files.");
        assert!(result.contains("<thinking>thinking about files</thinking>"));
        assert!(result.contains(r#"<tool_call name="shell">{"cmd":"ls"}</tool_call>"#));
        assert!(result.contains("<tool_result>file1.txt\nfile2.txt</tool_result>"));
        assert!(result.contains("<response>Here are the files.</response>"));
    }

    #[test]
    fn build_enriched_response_without_tools() {
        let messages = vec![
            ChatMessage::assistant("Simple answer."),
        ];
        let result = build_enriched_response(&messages, "Simple answer.");
        assert_eq!(result, "Simple answer.");
        assert!(!result.contains("<response>"));
    }

    #[test]
    fn build_enriched_response_empty_messages() {
        let result = build_enriched_response(&[], "hello");
        assert_eq!(result, "hello");
    }

    #[test]
    fn build_enriched_response_alias_mode() {
        let messages = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: r#"<tool_call name="shell">{"cmd":"pwd"}</tool_call>"#.to_string(),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: r#"{"tool_call_id":"t1","content":"/home/user"}"#.to_string(),
            },
            ChatMessage::assistant("You are in /home/user."),
        ];
        let result = build_enriched_response(&messages, "You are in /home/user.");
        assert!(result.contains(r#"<tool_call name="shell">{"cmd":"pwd"}</tool_call>"#));
        assert!(result.contains("<tool_result>/home/user</tool_result>"));
        assert!(result.contains("<response>You are in /home/user.</response>"));
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

    // --- estimated_message_tokens ---

    #[test]
    fn estimated_message_tokens_formula() {
        // Formula: (chars + 2) / 3 + 4
        let msg = ChatMessage::user("hello"); // 5 chars → (5+2)/3+4 = 2+4 = 6
        assert_eq!(estimated_message_tokens(&msg), 6);

        let empty = ChatMessage::user(""); // 0 chars → (0+2)/3+4 = 0+4 = 4
        assert_eq!(estimated_message_tokens(&empty), 4);
    }

    // --- trim_ws_history_to_budget ---

    #[test]
    fn trim_ws_history_preserves_system_prompt() {
        let mut history = vec![ChatMessage::system("system")];
        let big = "a".repeat(600);
        for _ in 0..500 {
            history.push(ChatMessage::user(&big));
            history.push(ChatMessage::assistant(&big));
        }
        let total_before: usize = history.iter().map(estimated_message_tokens).sum();
        assert!(total_before > WS_CONTEXT_TOKEN_LIMIT);
        trim_ws_history_to_budget(&mut history);
        assert_eq!(history[0].role, "system");
        let total_after: usize = history.iter().map(estimated_message_tokens).sum();
        assert!(total_after <= WS_CONTEXT_TOKEN_TARGET + 250);
    }

    #[test]
    fn trim_ws_history_no_op_when_within_budget() {
        let mut history = vec![
            ChatMessage::system("system"),
            ChatMessage::user("hello"),
            ChatMessage::assistant("hi"),
        ];
        let original_len = history.len();
        trim_ws_history_to_budget(&mut history);
        assert_eq!(history.len(), original_len);
    }

    #[test]
    fn trim_ws_history_respects_token_budget() {
        let mut history = vec![ChatMessage::system("sys")];
        let big_msg = "x".repeat(100_000);
        history.push(ChatMessage::user(&big_msg));
        history.push(ChatMessage::assistant(&big_msg));
        history.push(ChatMessage::user("latest"));
        trim_ws_history_to_budget(&mut history);
        let total_tokens: usize = history.iter().map(estimated_message_tokens).sum();
        assert!(total_tokens <= WS_CONTEXT_TOKEN_TARGET + 35_000);
        assert!(history.iter().any(|m| m.content == "latest"));
    }

    #[test]
    fn trim_ws_history_keeps_minimum_messages() {
        let mut history = vec![ChatMessage::system("sys")];
        let big_msg = "x".repeat(100_000);
        for _ in 0..WS_CONTEXT_MIN_KEEP {
            history.push(ChatMessage::user(&big_msg));
        }
        let original_non_system = history.iter().filter(|m| m.role != "system").count();
        assert_eq!(original_non_system, WS_CONTEXT_MIN_KEEP);
        trim_ws_history_to_budget(&mut history);
        let remaining_non_system = history.iter().filter(|m| m.role != "system").count();
        assert_eq!(remaining_non_system, WS_CONTEXT_MIN_KEEP);
    }

    // --- truncate_with_ellipsis ---

    #[test]
    fn truncate_with_ellipsis_no_op_short() {
        assert_eq!(truncate_with_ellipsis("hello", 10), "hello");
    }

    #[test]
    fn truncate_with_ellipsis_truncates_long() {
        let result = truncate_with_ellipsis("hello world", 8);
        assert_eq!(result, "hello wo...");
    }

    #[test]
    fn truncate_with_ellipsis_trims_trailing_whitespace() {
        let result = truncate_with_ellipsis("hello world", 6);
        assert_eq!(result, "hello...");
    }

    // --- should_skip_memory_entry ---

    #[test]
    fn skip_memory_entry_assistant_resp() {
        assert!(should_skip_memory_entry("assistant_resp", "some content"));
        assert!(should_skip_memory_entry("assistant_resp_123", "some content"));
        assert!(should_skip_memory_entry("ASSISTANT_RESP", "some content"));
    }

    #[test]
    fn skip_memory_entry_history() {
        assert!(should_skip_memory_entry("chat_history", "content"));
        assert!(should_skip_memory_entry("session_history", "content"));
    }

    #[test]
    fn skip_memory_entry_oversized() {
        let big = "x".repeat(MEMORY_CONTEXT_MAX_CHARS + 1);
        assert!(should_skip_memory_entry("normal_key", &big));
    }

    #[test]
    fn skip_memory_entry_allows_normal() {
        assert!(!should_skip_memory_entry("user_preference", "likes coffee"));
    }

    // --- is_ws_loopback ---

    #[test]
    fn is_ws_loopback_detects_ipv4() {
        let addr: SocketAddr = "127.0.0.1:1234".parse().unwrap();
        assert!(is_ws_loopback(Some(addr), &HeaderMap::new(), false));
    }

    #[test]
    fn is_ws_loopback_detects_ipv6() {
        let addr: SocketAddr = "[::1]:1234".parse().unwrap();
        assert!(is_ws_loopback(Some(addr), &HeaderMap::new(), false));
    }

    #[test]
    fn is_ws_loopback_rejects_public_ip() {
        let addr: SocketAddr = "1.2.3.4:1234".parse().unwrap();
        assert!(!is_ws_loopback(Some(addr), &HeaderMap::new(), false));
    }

    // --- cancellation token ---

    #[tokio::test]
    async fn cancellation_token_starts_not_cancelled() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());
    }

    #[tokio::test]
    async fn cancellation_token_propagates_to_clone() {
        let token = CancellationToken::new();
        let clone = token.clone();
        token.cancel();
        assert!(clone.is_cancelled());
    }

    #[tokio::test]
    async fn cancellation_token_cancelled_future_resolves() {
        let token = CancellationToken::new();
        let clone = token.clone();
        let handle = tokio::spawn(async move {
            clone.cancelled().await;
            true
        });
        token.cancel();
        assert!(handle.await.unwrap());
    }
}
