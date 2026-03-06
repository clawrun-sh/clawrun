/* Auto-generated from zeroclaw-config.schema.json — do not edit */

/**
 * Natural-language behavior for non-CLI approval-management commands.
 */
export type NonCliNaturalLanguageApprovalMode = "disabled" | "request_confirm" | "direct";
/**
 * Chat context selector for ACK emoji reaction rules.
 */
export type AckReactionChatType = "direct" | "group";
/**
 * Reaction selection strategy for ACK emoji pools.
 */
export type AckReactionStrategy = "random" | "first";
/**
 * Group-chat reply trigger mode for channels that support mention gating.
 */
export type GroupReplyMode = "mention_only" | "all_messages";
/**
 * Protocol mode for `custom:` OpenAI-compatible providers.
 */
export type ProviderApiMode = "open-ai-chat-completions" | "open-ai-responses";

/**
 * Top-level ZeroClaw configuration, loaded from `config.toml`.
 *
 * Resolution order: `ZEROCLAW_WORKSPACE` env → `active_workspace.toml` marker → `~/.zeroclaw/config.toml`.
 */
export interface Config {
  agent?: AgentConfig;
  /**
   * Delegate agent configurations for multi-agent workflows.
   */
  agents?: {
    [k: string]: DelegateAgentConfig;
  };
  agents_ipc?: AgentsIpcConfig;
  /**
   * API key for the selected provider. Always overridden by `ZEROCLAW_API_KEY` env var.
   * `API_KEY` env var is only used as fallback when no config key is set.
   */
  api_key?: string | null;
  /**
   * Base URL override for provider API (e.g. "http://10.0.0.1:11434" for remote Ollama)
   */
  api_url?: string | null;
  autonomy?: AutonomyConfig;
  browser?: BrowserConfig;
  channels_config?: ChannelsConfig;
  composio?: ComposioConfig;
  coordination?: CoordinationConfig;
  cost?: CostConfig;
  cron?: CronConfig;
  /**
   * Default model routed through the selected provider (e.g. `"anthropic/claude-sonnet-4-6"`).
   */
  default_model?: string | null;
  /**
   * Default provider ID or alias (e.g. `"openrouter"`, `"ollama"`, `"anthropic"`). Default: `"openrouter"`.
   */
  default_provider?: string | null;
  /**
   * Default model temperature (0.0–2.0). Default: `0.7`.
   */
  default_temperature: number;
  economic?: EconomicConfig;
  /**
   * Embedding routing rules — route `hint:<name>` to specific provider+model combos.
   */
  embedding_routes?: EmbeddingRouteConfig[];
  gateway?: GatewayConfig;
  goal_loop?: GoalLoopConfig;
  hardware?: HardwareConfig;
  heartbeat?: HeartbeatConfig;
  hooks?: HooksConfig;
  http_request?: HttpRequestConfig;
  identity?: IdentityConfig;
  mcp?: McpConfig;
  memory?: MemoryConfig;
  /**
   * Optional named provider profiles keyed by id (Codex app-server compatible layout).
   */
  model_providers?: {
    [k: string]: ModelProviderConfig;
  };
  /**
   * Model routing rules — route `hint:<name>` to specific provider+model combos.
   */
  model_routes?: ModelRouteConfig[];
  /**
   * Vision support override for the active provider/model.
   * - `None` (default): use provider's built-in default
   * - `Some(true)`: force vision support on (e.g. Ollama running llava)
   * - `Some(false)`: force vision support off
   */
  model_support_vision?: boolean | null;
  multimodal?: MultimodalConfig;
  observability?: ObservabilityConfig;
  peripherals?: PeripheralsConfig;
  plugins?: PluginsConfig;
  provider?: ProviderConfig;
  /**
   * Optional API protocol mode for `custom:` providers.
   */
  provider_api?: ProviderApiMode | null;
  proxy?: ProxyConfig;
  query_classification?: QueryClassificationConfig;
  reliability?: ReliabilityConfig;
  research?: ResearchPhaseConfig;
  runtime?: RuntimeConfig;
  scheduler?: SchedulerConfig;
  secrets?: SecretsConfig;
  security?: SecurityConfig;
  skills?: SkillsConfig;
  storage?: StorageConfig;
  transcription?: TranscriptionConfig;
  tunnel?: TunnelConfig;
  wasm?: WasmConfig;
  web_fetch?: WebFetchConfig;
  web_search?: WebSearchConfig;
  [k: string]: unknown;
}
/**
 * Agent orchestration settings (`[agent]`).
 */
export interface AgentConfig {
  /**
   * Optional allowlist for primary-agent tool visibility.
   * When non-empty, only listed tools are exposed to the primary agent.
   */
  allowed_tools?: string[];
  /**
   * When true: bootstrap_max_chars=6000, rag_chunk_limit=2. Use for 13B or smaller models.
   */
  compact_context?: boolean;
  /**
   * Optional denylist for primary-agent tool visibility.
   * Applied after `allowed_tools`.
   */
  denied_tools?: string[];
  /**
   * Loop detection: consecutive failure streak threshold.
   * Triggers when the same tool fails this many times in a row.
   * Set to `0` to disable. Default: `3`.
   */
  loop_detection_failure_streak?: number;
  /**
   * Loop detection: no-progress repeat threshold.
   * Triggers when the same tool+args produces identical output this many times.
   * Set to `0` to disable. Default: `3`.
   */
  loop_detection_no_progress_threshold?: number;
  /**
   * Loop detection: ping-pong cycle threshold.
   * Detects A→B→A→B alternating patterns with no progress.
   * Value is number of full cycles (A-B = 1 cycle). Set to `0` to disable. Default: `2`.
   */
  loop_detection_ping_pong_cycles?: number;
  /**
   * Maximum conversation history messages retained per session. Default: `50`.
   */
  max_history_messages?: number;
  /**
   * Maximum tool-call loop turns per user message. Default: `20`.
   * Setting to `0` falls back to the safe default of `20`.
   */
  max_tool_iterations?: number;
  /**
   * Enable parallel tool execution within a single iteration. Default: `false`.
   */
  parallel_tools?: boolean;
  /**
   * Safety heartbeat injection interval inside `run_tool_call_loop`.
   * Injects a security-constraint reminder every N tool iterations.
   * Set to `0` to disable. Default: `5`.
   * Compatibility/rollback: omit/remove this key to use default (`5`), or set
   * to `0` for explicit disable.
   */
  safety_heartbeat_interval?: number;
  /**
   * Safety heartbeat injection interval for interactive sessions.
   * Injects a security-constraint reminder every N conversation turns.
   * Set to `0` to disable. Default: `10`.
   * Compatibility/rollback: omit/remove this key to use default (`10`), or
   * set to `0` for explicit disable.
   */
  safety_heartbeat_turn_interval?: number;
  session?: AgentSessionConfig;
  subagents?: SubAgentsConfig;
  teams?: AgentTeamsConfig;
  /**
   * Tool dispatch strategy (e.g. `"auto"`). Default: `"auto"`.
   */
  tool_dispatcher?: string;
  [k: string]: unknown;
}
/**
 * Session persistence configuration (`[agent.session]` section).
 */
export interface AgentSessionConfig {
  /**
   * Session backend to use. Options: "memory", "sqlite", "none".
   * Default: "none" (no persistence).
   * Set to "none" to disable session persistence entirely.
   */
  backend?: "memory" | "sqlite" | "none";
  /**
   * Maximum number of messages to retain per session.
   * Default: 50.
   */
  max_messages?: number;
  /**
   * Strategy for resolving session IDs. Options: "per-sender", "per-channel", "main".
   * Default: "per-sender" (each user gets a unique session per channel).
   */
  strategy?: "per-sender" | "per-channel" | "main";
  /**
   * Time-to-live for sessions in seconds.
   * Default: 3600 (1 hour).
   */
  ttl_seconds?: number;
  [k: string]: unknown;
}
/**
 * Sub-agent runtime controls for background delegation.
 */
export interface SubAgentsConfig {
  /**
   * Allow automatic sub-agent selection when a specific agent is not given.
   */
  auto_activate?: boolean;
  /**
   * Enable background sub-agent tools.
   */
  enabled?: boolean;
  /**
   * Penalty multiplier applied to each currently in-flight task.
   */
  inflight_penalty?: number;
  /**
   * Sliding window (seconds) used to compute recent load/failure signals.
   */
  load_window_secs?: number;
  /**
   * Maximum number of concurrently running background sub-agents.
   */
  max_concurrent?: number;
  /**
   * Poll interval while waiting for a concurrency slot.
   */
  queue_poll_ms?: number;
  /**
   * When at concurrency limit, wait this long for a slot before failing.
   * Set to `0` for immediate fail-fast behavior.
   */
  queue_wait_ms?: number;
  /**
   * Penalty multiplier applied to recent failure count in load window.
   */
  recent_failure_penalty?: number;
  /**
   * Penalty multiplier applied to recent assignment count in load window.
   */
  recent_selection_penalty?: number;
  /**
   * Runtime strategy used for automatic sub-agent selection.
   */
  strategy?: "semantic" | "adaptive" | "least_loaded";
  [k: string]: unknown;
}
/**
 * Agent-team runtime controls for synchronous delegation.
 */
export interface AgentTeamsConfig {
  /**
   * Allow automatic team-agent selection when a specific agent is not given.
   */
  auto_activate?: boolean;
  /**
   * Enable agent-team delegation tools.
   */
  enabled?: boolean;
  /**
   * Penalty multiplier applied to each currently in-flight task.
   */
  inflight_penalty?: number;
  /**
   * Sliding window (seconds) used to compute recent load/failure signals.
   */
  load_window_secs?: number;
  /**
   * Maximum number of delegate profiles activated as team members.
   */
  max_agents?: number;
  /**
   * Penalty multiplier applied to recent failure count in load window.
   */
  recent_failure_penalty?: number;
  /**
   * Penalty multiplier applied to recent assignment count in load window.
   */
  recent_selection_penalty?: number;
  /**
   * Runtime strategy used for automatic team-agent selection.
   */
  strategy?: "semantic" | "adaptive" | "least_loaded";
  [k: string]: unknown;
}
/**
 * Configuration for a delegate sub-agent used by the `delegate` tool.
 */
export interface DelegateAgentConfig {
  /**
   * Enable agentic sub-agent mode (multi-turn tool-call loop).
   */
  agentic?: boolean;
  /**
   * Allowlist of tool names available to the sub-agent in agentic mode.
   */
  allowed_tools?: string[];
  /**
   * Optional API key override
   */
  api_key?: string | null;
  /**
   * Optional capability tags used by automatic agent selection.
   */
  capabilities?: string[];
  /**
   * Whether this delegate profile is active for selection/invocation.
   */
  enabled?: boolean;
  /**
   * Max recursion depth for nested delegation
   */
  max_depth?: number;
  /**
   * Maximum tool-call iterations in agentic mode.
   */
  max_iterations?: number;
  /**
   * Model name
   */
  model: string;
  /**
   * Priority hint for automatic agent selection (higher wins on ties).
   */
  priority?: number;
  /**
   * Provider name (e.g. "ollama", "openrouter", "anthropic")
   */
  provider: string;
  /**
   * Optional system prompt for the sub-agent
   */
  system_prompt?: string | null;
  /**
   * Temperature override
   */
  temperature?: number | null;
  [k: string]: unknown;
}
/**
 * Inter-process agent communication (`[agents_ipc]`).
 */
export interface AgentsIpcConfig {
  /**
   * Path to shared SQLite database (all agents on this host share one file).
   */
  db_path?: string;
  /**
   * Enable inter-process agent communication tools.
   */
  enabled?: boolean;
  /**
   * Agents not seen within this window are considered offline (seconds).
   */
  staleness_secs?: number;
  [k: string]: unknown;
}
/**
 * Autonomy and security policy configuration (`[autonomy]`).
 */
export interface AutonomyConfig {
  /**
   * Allow `file_read` to access sensitive workspace secrets such as `.env`,
   * key material, and credential files.
   *
   * Default is `false` to reduce accidental secret exposure via tool output.
   */
  allow_sensitive_file_reads?: boolean;
  /**
   * Allow `file_write` / `file_edit` to modify sensitive workspace secrets
   * such as `.env`, key material, and credential files.
   *
   * Default is `false` to reduce accidental secret corruption/exfiltration.
   */
  allow_sensitive_file_writes?: boolean;
  /**
   * Allowlist of executable names permitted for shell execution.
   */
  allowed_commands: string[];
  /**
   * Extra directory roots the agent may read/write outside the workspace.
   * Supports absolute, `~/...`, and workspace-relative entries.
   * Resolved paths under any of these roots pass `is_resolved_path_allowed`.
   */
  allowed_roots?: string[];
  /**
   * Tools that always require interactive approval, even after "Always".
   */
  always_ask?: string[];
  /**
   * Tools that never require approval (e.g. read-only tools).
   */
  auto_approve?: string[];
  /**
   * Block high-risk shell commands even if allowlisted.
   */
  block_high_risk_commands?: boolean;
  /**
   * Context-aware shell command allow/deny rules.
   *
   * These rules are evaluated per command segment and can narrow or override
   * global `allowed_commands` behavior for matching commands.
   */
  command_context_rules?: CommandContextRuleConfig[];
  /**
   * Explicit path denylist. Default includes system-critical paths and sensitive dotdirs.
   */
  forbidden_paths: string[];
  /**
   * Autonomy level: `read_only`, `supervised` (default), or `full`.
   */
  level: "readonly" | "supervised" | "full";
  /**
   * Maximum actions allowed per hour per policy. Default: `100`.
   */
  max_actions_per_hour: number;
  /**
   * Maximum cost per day in cents per policy. Default: `1000`.
   */
  max_cost_per_day_cents: number;
  /**
   * Optional allowlist for who can manage non-CLI approval commands.
   *
   * When empty, any sender already admitted by the channel allowlist can
   * use approval-management commands.
   *
   * Supported entry formats:
   * - `"*"`: allow any sender on any channel
   * - `"alice"`: allow sender `alice` on any channel
   * - `"telegram:alice"`: allow sender `alice` only on `telegram`
   * - `"telegram:*"`: allow any sender on `telegram`
   * - `"*:alice"`: allow sender `alice` on any channel
   */
  non_cli_approval_approvers?: string[];
  /**
   * Tools to exclude from non-CLI channels (e.g. Telegram, Discord).
   *
   * When a tool is listed here, non-CLI channels will not expose it to the
   * model in tool specs.
   */
  non_cli_excluded_tools?: string[];
  /**
   * Natural-language handling mode for non-CLI approval-management commands.
   *
   * Values:
   * - `direct` (default): phrases like `授权工具 shell` immediately approve.
   * - `request_confirm`: phrases create pending requests requiring confirm.
   * - `disabled`: ignore natural-language approval commands (slash only).
   */
  non_cli_natural_language_approval_mode?: "disabled" | "request_confirm" | "direct";
  /**
   * Optional per-channel override for natural-language approval mode.
   *
   * Keys are channel names (for example: `telegram`, `discord`, `slack`).
   * Values use the same enum as `non_cli_natural_language_approval_mode`.
   *
   * Example:
   * - `telegram = "direct"` for private-chat ergonomics
   * - `discord = "request_confirm"` for stricter team channels
   */
  non_cli_natural_language_approval_mode_by_channel?: {
    [k: string]: NonCliNaturalLanguageApprovalMode;
  };
  /**
   * Require explicit approval for medium-risk shell commands.
   */
  require_approval_for_medium_risk?: boolean;
  /**
   * Additional environment variables allowed for shell tool subprocesses.
   *
   * These names are explicitly allowlisted and merged with the built-in safe
   * baseline (`PATH`, `HOME`, etc.) after `env_clear()`.
   */
  shell_env_passthrough?: string[];
  /**
   * Restrict absolute filesystem paths to workspace-relative references. Default: `true`.
   * Resolved paths outside the workspace still require `allowed_roots`.
   */
  workspace_only: boolean;
  [k: string]: unknown;
}
/**
 * Context-aware command rule for shell commands.
 *
 * Rules are evaluated per command segment. Command matching accepts command
 * names (`curl`), explicit paths (`/usr/bin/curl`), and wildcard (`*`).
 *
 * Matching semantics:
 * - `action = "deny"`: if all constraints match, the segment is rejected.
 * - `action = "allow"`: if at least one allow rule exists for a command,
 *   segments must match at least one of those allow rules.
 * - `action = "require_approval"`: matching segments require explicit
 *   `approved=true` in supervised mode, even when `shell` is auto-approved.
 *
 * Constraints are optional:
 * - `allowed_domains`: require URL arguments to match these hosts/patterns.
 * - `allowed_path_prefixes`: require path-like arguments to stay under these prefixes.
 * - `denied_path_prefixes`: for deny rules, match when any path-like argument
 *   is under these prefixes; for allow rules, require path arguments not to hit
 *   these prefixes.
 */
export interface CommandContextRuleConfig {
  /**
   * Rule action (`allow` | `deny` | `require_approval`). Defaults to `allow`.
   */
  action?: "allow" | "deny" | "require_approval";
  /**
   * Permit high-risk commands when this allow rule matches.
   *
   * The command still requires explicit `approved=true` in supervised mode.
   */
  allow_high_risk?: boolean;
  /**
   * Allowed host patterns for URL arguments.
   *
   * Supports exact hosts (`api.example.com`) and wildcard suffixes (`*.example.com`).
   */
  allowed_domains?: string[];
  /**
   * Allowed path prefixes for path-like arguments.
   *
   * Prefixes may be absolute, `~/...`, or workspace-relative.
   */
  allowed_path_prefixes?: string[];
  /**
   * Command name/path pattern (`git`, `/usr/bin/curl`, or `*`).
   */
  command: string;
  /**
   * Denied path prefixes for path-like arguments.
   *
   * Prefixes may be absolute, `~/...`, or workspace-relative.
   */
  denied_path_prefixes?: string[];
  [k: string]: unknown;
}
/**
 * Browser automation configuration (`[browser]`).
 */
export interface BrowserConfig {
  /**
   * Agent-browser executable path/name
   */
  agent_browser_command?: string;
  /**
   * Additional arguments passed to agent-browser before each action command
   */
  agent_browser_extra_args?: string[];
  /**
   * Timeout in milliseconds for each agent-browser command invocation
   */
  agent_browser_timeout_ms?: number;
  /**
   * Allowed domains for `browser_open` (exact or subdomain match)
   */
  allowed_domains?: string[];
  /**
   * Auto backend priority order (only used when backend = "auto")
   * Supported values: "agent_browser", "rust_native", "computer_use"
   */
  auto_backend_priority?: string[];
  /**
   * Browser automation backend: "agent_browser" | "rust_native" | "computer_use" | "auto"
   */
  backend?: string;
  /**
   * Browser for browser_open tool: "disable" | "brave" | "chrome" | "firefox" | "edge" | "msedge" | "default"
   */
  browser_open?: string;
  computer_use?: BrowserComputerUseConfig;
  /**
   * Enable `browser_open` tool (opens URLs in the system browser without scraping)
   */
  enabled?: boolean;
  /**
   * Optional Chrome/Chromium executable path for rust-native backend
   */
  native_chrome_path?: string | null;
  /**
   * Headless mode for rust-native backend
   */
  native_headless?: boolean;
  /**
   * WebDriver endpoint URL for rust-native backend (e.g. http://127.0.0.1:9515)
   */
  native_webdriver_url?: string;
  /**
   * Browser session name (for agent-browser automation)
   */
  session_name?: string | null;
  [k: string]: unknown;
}
/**
 * Computer-use sidecar configuration
 */
export interface BrowserComputerUseConfig {
  /**
   * Allow remote/public endpoint for computer-use sidecar (default: false)
   */
  allow_remote_endpoint?: boolean;
  /**
   * Optional bearer token for computer-use sidecar
   */
  api_key?: string | null;
  /**
   * Sidecar endpoint for computer-use actions (OS-level mouse/keyboard/screenshot)
   */
  endpoint?: string;
  /**
   * Optional X-axis boundary for coordinate-based actions
   */
  max_coordinate_x?: number | null;
  /**
   * Optional Y-axis boundary for coordinate-based actions
   */
  max_coordinate_y?: number | null;
  /**
   * Per-action request timeout in milliseconds
   */
  timeout_ms?: number;
  /**
   * Optional window title/process allowlist forwarded to sidecar policy
   */
  window_allowlist?: string[];
  [k: string]: unknown;
}
/**
 * Channel configurations: Telegram, Discord, Slack, etc. (`[channels_config]`).
 */
export interface ChannelsConfig {
  ack_reaction?: AckReactionChannelsConfig;
  /**
   * ACP (Agent Client Protocol) channel configuration.
   */
  acp?: AcpConfig | null;
  /**
   * BlueBubbles iMessage bridge channel configuration.
   */
  bluebubbles?: BlueBubblesConfig | null;
  /**
   * ClawdTalk voice channel configuration.
   */
  clawdtalk?: ClawdTalkConfig | null;
  /**
   * Enable the CLI interactive channel. Default: `true`.
   */
  cli: boolean;
  /**
   * DingTalk channel configuration.
   */
  dingtalk?: DingTalkConfig | null;
  /**
   * Discord bot channel configuration.
   */
  discord?: DiscordConfig | null;
  /**
   * Email channel configuration.
   */
  email?: EmailConfig | null;
  /**
   * Feishu channel configuration.
   */
  feishu?: FeishuConfig | null;
  /**
   * GitHub channel configuration.
   */
  github?: GitHubConfig | null;
  /**
   * iMessage channel configuration (macOS only).
   */
  imessage?: IMessageConfig | null;
  /**
   * IRC channel configuration.
   */
  irc?: IrcConfig | null;
  /**
   * Lark channel configuration.
   */
  lark?: LarkConfig | null;
  /**
   * Linq Partner API channel configuration.
   */
  linq?: LinqConfig | null;
  /**
   * Matrix channel configuration.
   */
  matrix?: MatrixConfig | null;
  /**
   * Mattermost bot channel configuration.
   */
  mattermost?: MattermostConfig | null;
  /**
   * Base timeout in seconds for processing a single channel message (LLM + tools).
   * Runtime uses this as a per-turn budget that scales with tool-loop depth
   * (up to 4x, capped) so one slow/retried model call does not consume the
   * entire conversation budget.
   * Default: 300s for on-device LLMs (Ollama) which are slower than cloud APIs.
   */
  message_timeout_secs?: number;
  /**
   * Napcat QQ protocol channel configuration.
   * Also accepts legacy key `[channels_config.onebot]` for OneBot v11 compatibility.
   */
  napcat?: NapcatConfig | null;
  /**
   * Nextcloud Talk bot channel configuration.
   */
  nextcloud_talk?: NextcloudTalkConfig | null;
  nostr?: NostrConfig | null;
  /**
   * QQ Official Bot channel configuration.
   */
  qq?: QQConfig | null;
  /**
   * Signal channel configuration.
   */
  signal?: SignalConfig | null;
  /**
   * Slack bot channel configuration.
   */
  slack?: SlackConfig | null;
  /**
   * Telegram bot channel configuration.
   */
  telegram?: TelegramConfig | null;
  /**
   * WATI WhatsApp Business API channel configuration.
   */
  wati?: WatiConfig | null;
  /**
   * Webhook channel configuration.
   */
  webhook?: WebhookConfig | null;
  /**
   * WhatsApp channel configuration (Cloud API or Web mode).
   */
  whatsapp?: WhatsAppConfig | null;
  [k: string]: unknown;
}
/**
 * ACK emoji reaction policy overrides for channels that support message reactions.
 *
 * Use this table to control reaction enable/disable, emoji pools, and conditional rules
 * without hardcoding behavior in channel implementations.
 */
export interface AckReactionChannelsConfig {
  /**
   * Discord ACK reaction policy.
   */
  discord?: AckReactionConfig | null;
  /**
   * Feishu ACK reaction policy.
   */
  feishu?: AckReactionConfig | null;
  /**
   * Lark ACK reaction policy.
   */
  lark?: AckReactionConfig | null;
  /**
   * Telegram ACK reaction policy.
   */
  telegram?: AckReactionConfig | null;
  [k: string]: unknown;
}
/**
 * Per-channel ACK emoji reaction policy.
 */
export interface AckReactionConfig {
  /**
   * Default emoji pool. When empty, channel built-in defaults are used.
   */
  emojis?: string[];
  /**
   * Global enable switch for ACK reactions on this channel.
   */
  enabled?: boolean;
  /**
   * Conditional rules evaluated in order.
   */
  rules?: AckReactionRuleConfig[];
  /**
   * Probabilistic gate in `[0.0, 1.0]` applied to default fallback selection.
   * Rule-level `sample_rate` overrides this for matched rules.
   */
  sample_rate?: number;
  /**
   * Reaction selection strategy for ACK emoji pools.
   */
  strategy?: "random" | "first";
  [k: string]: unknown;
}
/**
 * Conditional ACK emoji reaction rule.
 */
export interface AckReactionRuleConfig {
  /**
   * Rule action (`react` or `suppress`).
   */
  action?: "react" | "suppress";
  /**
   * Match only for these chat/channel IDs. `*` matches any chat.
   */
  chat_ids?: string[];
  /**
   * Match only for selected chat types; empty means no chat-type constraint.
   */
  chat_types?: AckReactionChatType[];
  /**
   * Match only when message contains all keywords (case-insensitive).
   */
  contains_all?: string[];
  /**
   * Match when message contains any keyword (case-insensitive).
   */
  contains_any?: string[];
  /**
   * Match only when message contains none of these keywords (case-insensitive).
   */
  contains_none?: string[];
  /**
   * Emoji pool used when this rule matches.
   */
  emojis?: string[];
  /**
   * Rule enable switch.
   */
  enabled?: boolean;
  /**
   * Match only for selected locale tags; supports prefix matching (`zh`, `zh_cn`).
   */
  locale_any?: string[];
  /**
   * Match only when all regex patterns match message text.
   */
  regex_all?: string[];
  /**
   * Match when any regex pattern matches message text.
   */
  regex_any?: string[];
  /**
   * Match only when none of these regex patterns match message text.
   */
  regex_none?: string[];
  /**
   * Optional probabilistic gate in `[0.0, 1.0]` for this rule.
   * When omitted, falls back to channel-level `sample_rate`.
   */
  sample_rate?: number | null;
  /**
   * Match only for these sender IDs. `*` matches any sender.
   */
  sender_ids?: string[];
  /**
   * Per-rule strategy override (falls back to parent strategy when omitted).
   */
  strategy?: AckReactionStrategy | null;
  [k: string]: unknown;
}
/**
 * ACP (Agent Client Protocol) channel configuration.
 *
 * Enables ZeroClaw to act as an ACP client, connecting to an OpenCode ACP server
 * via `opencode acp` command for JSON-RPC 2.0 communication over stdio.
 */
export interface AcpConfig {
  /**
   * Allowed user identifiers (empty = deny all, "*" = allow all).
   */
  allowed_users?: string[];
  /**
   * Additional arguments to pass to `opencode acp`.
   */
  extra_args?: string[];
  /**
   * OpenCode binary path (default: "opencode").
   */
  opencode_path?: string | null;
  /**
   * Working directory for OpenCode process.
   */
  workdir?: string | null;
  [k: string]: unknown;
}
/**
 * BlueBubbles iMessage bridge channel configuration.
 *
 * BlueBubbles is a self-hosted macOS server that exposes iMessage via a
 * REST API and webhook push notifications. See <https://bluebubbles.app>.
 */
export interface BlueBubblesConfig {
  /**
   * Allowed sender handles (phone numbers or Apple IDs). Use `["*"]` to allow all.
   */
  allowed_senders?: string[];
  /**
   * Sender handles to silently ignore (e.g. suppress echoed outbound messages).
   */
  ignore_senders?: string[];
  /**
   * BlueBubbles server password.
   */
  password: string;
  /**
   * BlueBubbles server URL (e.g. `http://192.168.1.100:1234` or an ngrok URL).
   */
  server_url: string;
  /**
   * Optional shared secret to authenticate inbound webhooks.
   * If set, incoming requests must include `Authorization: Bearer <secret>`.
   */
  webhook_secret?: string | null;
  [k: string]: unknown;
}
/**
 * Configuration for ClawdTalk channel from config.toml
 */
export interface ClawdTalkConfig {
  /**
   * Allowed destination numbers or patterns
   */
  allowed_destinations?: string[];
  /**
   * Telnyx API key
   */
  api_key: string;
  /**
   * Telnyx connection ID for SIP
   */
  connection_id: string;
  /**
   * Phone number to call from (E.164 format)
   */
  from_number: string;
  /**
   * Webhook secret for signature verification
   */
  webhook_secret?: string | null;
  [k: string]: unknown;
}
/**
 * DingTalk configuration for Stream Mode messaging
 */
export interface DingTalkConfig {
  /**
   * Allowed user IDs (staff IDs). Empty = deny all, "*" = allow all
   */
  allowed_users?: string[];
  /**
   * Client ID (AppKey) from DingTalk developer console
   */
  client_id: string;
  /**
   * Client Secret (AppSecret) from DingTalk developer console
   */
  client_secret: string;
  [k: string]: unknown;
}
/**
 * Discord bot channel configuration.
 */
export interface DiscordConfig {
  /**
   * Allowed Discord user IDs. Empty = deny all.
   */
  allowed_users?: string[];
  /**
   * Discord bot token (from Discord Developer Portal).
   */
  bot_token: string;
  /**
   * Group-chat trigger controls.
   */
  group_reply?: GroupReplyConfig | null;
  /**
   * Optional guild (server) ID to restrict the bot to a single guild.
   */
  guild_id?: string | null;
  /**
   * When true, process messages from other bots (not just humans).
   * The bot still ignores its own messages to prevent feedback loops.
   */
  listen_to_bots?: boolean;
  /**
   * When true, only respond to messages that @-mention the bot.
   * Other messages in the guild are silently ignored.
   */
  mention_only?: boolean;
  [k: string]: unknown;
}
/**
 * Advanced group-chat trigger controls.
 */
export interface GroupReplyConfig {
  /**
   * Sender IDs that always trigger group replies.
   *
   * These IDs bypass mention gating in group chats, but do not bypass the
   * channel-level inbound allowlist (`allowed_users` / equivalents).
   */
  allowed_sender_ids?: string[];
  /**
   * Optional explicit trigger mode.
   *
   * If omitted, channel-specific legacy behavior is used for compatibility.
   */
  mode?: GroupReplyMode | null;
  [k: string]: unknown;
}
/**
 * Email channel configuration
 */
export interface EmailConfig {
  /**
   * Allowed sender addresses/domains (empty = deny all, ["*"] = allow all)
   */
  allowed_senders?: string[];
  /**
   * From address for outgoing emails
   */
  from_address: string;
  /**
   * IDLE timeout in seconds before re-establishing connection (default: 1740 = 29 minutes)
   * RFC 2177 recommends clients restart IDLE every 29 minutes
   */
  idle_timeout_secs?: number;
  /**
   * IMAP folder to poll (default: INBOX)
   */
  imap_folder?: string;
  /**
   * IMAP server hostname
   */
  imap_host: string;
  imap_id?: EmailImapIdConfig;
  /**
   * IMAP server port (default: 993 for TLS)
   */
  imap_port?: number;
  /**
   * Email password for authentication
   */
  password: string;
  /**
   * SMTP server hostname
   */
  smtp_host: string;
  /**
   * SMTP server port (default: 465 for TLS)
   */
  smtp_port?: number;
  /**
   * Use TLS for SMTP (default: true)
   */
  smtp_tls?: boolean;
  /**
   * Email username for authentication
   */
  username: string;
  [k: string]: unknown;
}
/**
 * Optional IMAP ID extension (RFC 2971) client identification.
 */
export interface EmailImapIdConfig {
  /**
   * Send IMAP `ID` command after login (recommended for some providers such as NetEase).
   */
  enabled?: boolean;
  /**
   * Client application name
   */
  name?: string;
  /**
   * Client vendor name
   */
  vendor?: string;
  /**
   * Client application version
   */
  version?: string;
  [k: string]: unknown;
}
/**
 * Feishu configuration for messaging integration.
 */
export interface FeishuConfig {
  /**
   * Allowed user IDs or union IDs (empty = deny all, "*" = allow all)
   */
  allowed_users?: string[];
  /**
   * App ID from Feishu developer console
   */
  app_id: string;
  /**
   * App Secret from Feishu developer console
   */
  app_secret: string;
  /**
   * Minimum interval between streaming draft edits (milliseconds).
   */
  draft_update_interval_ms?: number;
  /**
   * Encrypt key for webhook message decryption (optional)
   */
  encrypt_key?: string | null;
  /**
   * Group-chat trigger controls.
   */
  group_reply?: GroupReplyConfig | null;
  /**
   * Maximum number of draft edits per message before finalizing.
   */
  max_draft_edits?: number;
  /**
   * HTTP port for webhook mode only. Must be set when receive_mode = "webhook".
   * Not required (and ignored) for websocket mode.
   */
  port?: number | null;
  /**
   * Event receive mode: "websocket" (default) or "webhook"
   */
  receive_mode?: "websocket" | "webhook";
  /**
   * Verification token for webhook validation (optional)
   */
  verification_token?: string | null;
  [k: string]: unknown;
}
/**
 * GitHub channel configuration (webhook receive + issue/PR comment send).
 */
export interface GitHubConfig {
  /**
   * GitHub token used for outbound API calls.
   *
   * Supports fine-grained PAT or installation token with `issues:write` / `pull_requests:write`.
   */
  access_token: string;
  /**
   * Allowed repositories (`owner/repo`), `owner/*`, or `*`.
   * Empty list denies all repositories.
   */
  allowed_repos?: string[];
  /**
   * Optional GitHub API base URL (for GHES).
   * Defaults to `https://api.github.com` when omitted.
   */
  api_base_url?: string | null;
  /**
   * Optional webhook secret to verify `X-Hub-Signature-256`.
   */
  webhook_secret?: string | null;
  [k: string]: unknown;
}
/**
 * iMessage channel configuration (macOS only).
 */
export interface IMessageConfig {
  /**
   * Allowed iMessage contacts (phone numbers or email addresses). Empty = deny all.
   */
  allowed_contacts: string[];
  [k: string]: unknown;
}
/**
 * IRC channel configuration.
 */
export interface IrcConfig {
  /**
   * Allowed nicknames (case-insensitive) or "*" for all
   */
  allowed_users?: string[];
  /**
   * Channels to join on connect
   */
  channels?: string[];
  /**
   * Bot nickname
   */
  nickname: string;
  /**
   * NickServ IDENTIFY password
   */
  nickserv_password?: string | null;
  /**
   * IRC server port (default: 6697 for TLS)
   */
  port?: number;
  /**
   * SASL PLAIN password (IRCv3)
   */
  sasl_password?: string | null;
  /**
   * IRC server hostname
   */
  server: string;
  /**
   * Server password (for bouncers like ZNC)
   */
  server_password?: string | null;
  /**
   * Username (defaults to nickname if not set)
   */
  username?: string | null;
  /**
   * Verify TLS certificate (default: true)
   */
  verify_tls?: boolean | null;
  [k: string]: unknown;
}
/**
 * Lark/Feishu configuration for messaging integration.
 * Lark is the international version; Feishu is the Chinese version.
 */
export interface LarkConfig {
  /**
   * Allowed user IDs or union IDs (empty = deny all, "*" = allow all)
   */
  allowed_users?: string[];
  /**
   * App ID from Lark/Feishu developer console
   */
  app_id: string;
  /**
   * App Secret from Lark/Feishu developer console
   */
  app_secret: string;
  /**
   * Minimum interval (ms) between draft message edits. Default: 3000.
   */
  draft_update_interval_ms?: number;
  /**
   * Encrypt key for webhook message decryption (optional)
   */
  encrypt_key?: string | null;
  /**
   * Group-chat trigger controls.
   */
  group_reply?: GroupReplyConfig | null;
  /**
   * Maximum number of edits per draft message before stopping updates.
   */
  max_draft_edits?: number;
  /**
   * When true, only respond to messages that @-mention the bot in groups.
   * Direct messages are always processed.
   */
  mention_only?: boolean;
  /**
   * HTTP port for webhook mode only. Must be set when receive_mode = "webhook".
   * Not required (and ignored) for websocket mode.
   */
  port?: number | null;
  /**
   * Event receive mode: "websocket" (default) or "webhook"
   */
  receive_mode?: "websocket" | "webhook";
  /**
   * Whether to use the Feishu (Chinese) endpoint instead of Lark (International)
   */
  use_feishu?: boolean;
  /**
   * Verification token for webhook validation (optional)
   */
  verification_token?: string | null;
  [k: string]: unknown;
}
export interface LinqConfig {
  /**
   * Allowed sender handles (phone numbers) or "*" for all
   */
  allowed_senders?: string[];
  /**
   * Linq Partner API token (Bearer auth)
   */
  api_token: string;
  /**
   * Phone number to send from (E.164 format)
   */
  from_phone: string;
  /**
   * Webhook signing secret for signature verification
   */
  signing_secret?: string | null;
  [k: string]: unknown;
}
/**
 * Matrix channel configuration.
 */
export interface MatrixConfig {
  /**
   * Matrix access token for the bot account.
   */
  access_token: string;
  /**
   * Allowed Matrix user IDs. Empty = deny all.
   */
  allowed_users: string[];
  /**
   * Optional Matrix device ID.
   */
  device_id?: string | null;
  /**
   * Matrix homeserver URL (e.g. `"https://matrix.org"`).
   */
  homeserver: string;
  /**
   * When true, only respond to direct rooms, explicit @-mentions, or replies to bot messages.
   */
  mention_only?: boolean;
  /**
   * Matrix room ID to listen in (e.g. `"!abc123:matrix.org"`).
   */
  room_id: string;
  /**
   * Optional Matrix user ID (e.g. `"@bot:matrix.org"`).
   */
  user_id?: string | null;
  [k: string]: unknown;
}
/**
 * Mattermost bot channel configuration.
 */
export interface MattermostConfig {
  /**
   * Allowed Mattermost user IDs. Empty = deny all.
   */
  allowed_users?: string[];
  /**
   * Mattermost bot access token.
   */
  bot_token: string;
  /**
   * Optional channel ID to restrict the bot to a single channel.
   */
  channel_id?: string | null;
  /**
   * Group-chat trigger controls.
   */
  group_reply?: GroupReplyConfig | null;
  /**
   * When true, only respond to messages that @-mention the bot.
   * Other messages in the channel are silently ignored.
   */
  mention_only?: boolean | null;
  /**
   * When true (default), replies thread on the original post.
   * When false, replies go to the channel root.
   */
  thread_replies?: boolean | null;
  /**
   * Mattermost server URL (e.g. `"https://mattermost.example.com"`).
   */
  url: string;
  [k: string]: unknown;
}
/**
 * Napcat channel configuration (QQ via OneBot-compatible API)
 */
export interface NapcatConfig {
  /**
   * Optional access token (Authorization Bearer token)
   */
  access_token?: string | null;
  /**
   * Allowed user IDs. Empty = deny all, "*" = allow all
   */
  allowed_users?: string[];
  /**
   * Optional Napcat HTTP API base URL. If omitted, derived from websocket_url.
   */
  api_base_url?: string;
  /**
   * Napcat WebSocket endpoint (for example `ws://127.0.0.1:3001`)
   */
  websocket_url: string;
  [k: string]: unknown;
}
/**
 * Nextcloud Talk bot configuration (webhook receive + OCS send API).
 */
export interface NextcloudTalkConfig {
  /**
   * Allowed Nextcloud actor IDs (`[]` = deny all, `"*"` = allow all).
   */
  allowed_users?: string[];
  /**
   * Bot app token used for OCS API bearer auth.
   */
  app_token: string;
  /**
   * Nextcloud base URL (e.g. "https://cloud.example.com").
   */
  base_url: string;
  /**
   * Shared secret for webhook signature verification.
   *
   * Can also be set via `ZEROCLAW_NEXTCLOUD_TALK_WEBHOOK_SECRET`.
   */
  webhook_secret?: string | null;
  [k: string]: unknown;
}
/**
 * Nostr channel configuration (NIP-04 + NIP-17 private messages)
 */
export interface NostrConfig {
  /**
   * Allowed sender public keys (hex or npub). Empty = deny all, "*" = allow all
   */
  allowed_pubkeys?: string[];
  /**
   * Private key in hex or nsec bech32 format
   */
  private_key: string;
  /**
   * Relay URLs (wss://). Defaults to popular public relays if omitted.
   */
  relays?: string[];
  [k: string]: unknown;
}
/**
 * QQ Official Bot configuration (Tencent QQ Bot SDK)
 */
export interface QQConfig {
  /**
   * Allowed user IDs. Empty = deny all, "*" = allow all
   */
  allowed_users?: string[];
  /**
   * App ID from QQ Bot developer console
   */
  app_id: string;
  /**
   * App Secret from QQ Bot developer console
   */
  app_secret: string;
  /**
   * API environment: "production" (default) or "sandbox".
   */
  environment?: "production" | "sandbox";
  /**
   * Event receive mode: "webhook" (default) or "websocket".
   */
  receive_mode?: "websocket" | "webhook";
  [k: string]: unknown;
}
export interface SignalConfig {
  /**
   * E.164 phone number of the signal-cli account (e.g. "+1234567890").
   */
  account: string;
  /**
   * Allowed sender phone numbers (E.164) or "*" for all.
   */
  allowed_from?: string[];
  /**
   * Optional group ID to filter messages.
   * - `None` or omitted: accept all messages (DMs and groups)
   * - `"dm"`: only accept direct messages
   * - Specific group ID: only accept messages from that group
   */
  group_id?: string | null;
  /**
   * Base URL for the signal-cli HTTP daemon (e.g. "http://127.0.0.1:8686").
   */
  http_url: string;
  /**
   * Skip messages that are attachment-only (no text body).
   */
  ignore_attachments?: boolean;
  /**
   * Skip incoming story messages.
   */
  ignore_stories?: boolean;
  [k: string]: unknown;
}
/**
 * Slack bot channel configuration.
 */
export interface SlackConfig {
  /**
   * Allowed Slack user IDs. Empty = deny all.
   */
  allowed_users?: string[];
  /**
   * Slack app-level token for Socket Mode (xapp-...).
   */
  app_token?: string | null;
  /**
   * Slack bot OAuth token (xoxb-...).
   */
  bot_token: string;
  /**
   * Optional channel ID to restrict the bot to a single channel.
   * Omit (or set `"*"`) to listen across all accessible channels.
   * Ignored when `channel_ids` is non-empty.
   */
  channel_id?: string | null;
  /**
   * Explicit list of channel/DM IDs to listen on simultaneously.
   * Takes precedence over `channel_id`. Empty = fall back to `channel_id`.
   */
  channel_ids?: string[];
  /**
   * Group-chat trigger controls.
   */
  group_reply?: GroupReplyConfig | null;
  [k: string]: unknown;
}
/**
 * Telegram bot channel configuration.
 */
export interface TelegramConfig {
  /**
   * When true, send emoji reaction acknowledgments (⚡️, 👌, 👀, 🔥, 👍) to incoming messages.
   * When false, no reaction is sent. Default is true.
   */
  ack_enabled?: boolean;
  /**
   * Allowed Telegram user IDs or usernames. Empty = deny all.
   */
  allowed_users: string[];
  /**
   * Optional custom base URL for Telegram-compatible APIs.
   * Defaults to "https://api.telegram.org" when omitted.
   * Example for Bale messenger: "https://tapi.bale.ai"
   */
  base_url?: string | null;
  /**
   * Telegram Bot API token (from @BotFather).
   */
  bot_token: string;
  /**
   * Minimum interval (ms) between draft message edits to avoid rate limits.
   */
  draft_update_interval_ms?: number;
  /**
   * Group-chat trigger controls.
   */
  group_reply?: GroupReplyConfig | null;
  /**
   * When true, a newer Telegram message from the same sender in the same chat
   * cancels the in-flight request and starts a fresh response with preserved history.
   */
  interrupt_on_new_message?: boolean;
  /**
   * When true, only respond to messages that @-mention the bot in groups.
   * Direct messages are always processed.
   */
  mention_only?: boolean;
  /**
   * Draft progress verbosity for streaming updates.
   */
  progress_mode?: "verbose" | "compact" | "off";
  /**
   * Streaming mode for progressive response delivery via message edits.
   */
  stream_mode?: "off" | "partial" | "on";
  [k: string]: unknown;
}
/**
 * WATI WhatsApp Business API channel configuration.
 */
export interface WatiConfig {
  /**
   * Allowed phone numbers (E.164 format) or "*" for all.
   */
  allowed_numbers?: string[];
  /**
   * WATI API token (Bearer auth).
   */
  api_token: string;
  /**
   * WATI API base URL (default: https://live-mt-server.wati.io).
   */
  api_url?: string;
  /**
   * Tenant ID for multi-channel setups (optional).
   */
  tenant_id?: string | null;
  /**
   * Shared secret for WATI webhook authentication.
   *
   * Supports `X-Hub-Signature-256` HMAC verification and Bearer-token fallback.
   * Can also be set via `ZEROCLAW_WATI_WEBHOOK_SECRET`.
   * Default: `None` (unset).
   * Compatibility/migration: additive key for existing deployments; set this
   * before enabling inbound WATI webhooks. Remove (or set null) to roll back.
   */
  webhook_secret?: string | null;
  [k: string]: unknown;
}
/**
 * Webhook channel configuration.
 */
export interface WebhookConfig {
  /**
   * Port to listen on for incoming webhooks.
   */
  port: number;
  /**
   * Optional shared secret for webhook signature verification.
   */
  secret?: string | null;
  [k: string]: unknown;
}
/**
 * WhatsApp channel configuration (Cloud API or Web mode).
 *
 * Set `phone_number_id` for Cloud API mode, or `session_path` for Web mode.
 */
export interface WhatsAppConfig {
  /**
   * Access token from Meta Business Suite (Cloud API mode)
   */
  access_token?: string | null;
  /**
   * Allowed phone numbers (E.164 format: +1234567890) or "*" for all
   */
  allowed_numbers?: string[];
  /**
   * App secret from Meta Business Suite (for webhook signature verification)
   * Can also be set via `ZEROCLAW_WHATSAPP_APP_SECRET` environment variable
   * Only used in Cloud API mode
   */
  app_secret?: string | null;
  /**
   * Custom pair code for linking (Web mode, optional)
   * Leave empty to let WhatsApp generate one
   */
  pair_code?: string | null;
  /**
   * Phone number for pair code linking (Web mode, optional)
   * Format: country code + number (e.g., "15551234567")
   * If not set, QR code pairing will be used
   */
  pair_phone?: string | null;
  /**
   * Phone number ID from Meta Business API (Cloud API mode)
   */
  phone_number_id?: string | null;
  /**
   * Session database path for WhatsApp Web client (Web mode)
   * When set, enables native WhatsApp Web mode with wa-rs
   */
  session_path?: string | null;
  /**
   * Webhook verify token (you define this, Meta sends it back for verification)
   * Only used in Cloud API mode
   */
  verify_token?: string | null;
  [k: string]: unknown;
}
/**
 * Composio managed OAuth tools integration (`[composio]`).
 */
export interface ComposioConfig {
  /**
   * Composio API key (stored encrypted when secrets.encrypt = true)
   */
  api_key?: string | null;
  /**
   * Enable Composio integration for 1000+ OAuth tools
   */
  enabled?: boolean;
  /**
   * Default entity ID for multi-user setups
   */
  entity_id?: string;
  [k: string]: unknown;
}
/**
 * Delegate coordination runtime configuration (`[coordination]`).
 */
export interface CoordinationConfig {
  /**
   * Enable delegate coordination tracing/runtime bus integration.
   */
  enabled?: boolean;
  /**
   * Logical lead-agent identity used as coordinator sender/recipient.
   */
  lead_agent?: string;
  /**
   * Maximum retained shared-context entries (`ContextPatch` state keys).
   */
  max_context_entries?: number;
  /**
   * Maximum retained dead-letter entries.
   */
  max_dead_letters?: number;
  /**
   * Maximum retained inbox messages per registered agent.
   */
  max_inbox_messages_per_agent?: number;
  /**
   * Maximum retained dedupe window size for processed message IDs.
   */
  max_seen_message_ids?: number;
  [k: string]: unknown;
}
/**
 * Cost tracking and budget enforcement configuration (`[cost]`).
 */
export interface CostConfig {
  /**
   * Allow requests to exceed budget with --override flag (default: false)
   */
  allow_override?: boolean;
  /**
   * Daily spending limit in USD (default: 10.00)
   */
  daily_limit_usd?: number;
  /**
   * Enable cost tracking (default: false)
   */
  enabled?: boolean;
  enforcement?: CostEnforcementConfig;
  /**
   * Monthly spending limit in USD (default: 100.00)
   */
  monthly_limit_usd?: number;
  /**
   * Per-model pricing (USD per 1M tokens)
   */
  prices?: {
    [k: string]: ModelPricing;
  };
  /**
   * Warn when spending reaches this percentage of limit (default: 80)
   */
  warn_at_percent?: number;
  [k: string]: unknown;
}
/**
 * Runtime budget enforcement policy (`[cost.enforcement]`).
 */
export interface CostEnforcementConfig {
  /**
   * Enforcement behavior. Default: `warn`.
   */
  mode?: "warn" | "route_down" | "block";
  /**
   * Extra reserve added to token/cost estimates (percentage, 0-100). Default: `10`.
   */
  reserve_percent?: number;
  /**
   * Optional fallback model (or `hint:*`) when `mode = "route_down"`.
   */
  route_down_model?: string | null;
  [k: string]: unknown;
}
/**
 * Per-model pricing entry (USD per 1M tokens).
 */
export interface ModelPricing {
  /**
   * Input price per 1M tokens
   */
  input?: number;
  /**
   * Output price per 1M tokens
   */
  output?: number;
  [k: string]: unknown;
}
/**
 * Cron job configuration (`[cron]`).
 */
export interface CronConfig {
  /**
   * Enable the cron subsystem. Default: `true`.
   */
  enabled?: boolean;
  /**
   * Maximum number of historical cron run records to retain. Default: `50`.
   */
  max_run_history?: number;
  [k: string]: unknown;
}
/**
 * Economic agent survival tracking (`[economic]`).
 * Tracks balance, token costs, work income, and survival status.
 */
export interface EconomicConfig {
  /**
   * Data directory for economic state persistence (relative to workspace)
   */
  data_path?: string | null;
  /**
   * Enable economic tracking (default: false)
   */
  enabled?: boolean;
  /**
   * Starting balance in USD (default: 1000.0)
   */
  initial_balance?: number;
  /**
   * Minimum evaluation score (0.0-1.0) to receive payment (default: 0.6)
   */
  min_evaluation_threshold?: number;
  token_pricing?: EconomicTokenPricing;
  [k: string]: unknown;
}
/**
 * Token pricing configuration
 */
export interface EconomicTokenPricing {
  /**
   * Price per million input tokens (USD)
   */
  input_price_per_million?: number;
  /**
   * Price per million output tokens (USD)
   */
  output_price_per_million?: number;
  [k: string]: unknown;
}
/**
 * Route an embedding hint to a specific provider + model.
 *
 * ```toml
 * [[embedding_routes]]
 * hint = "semantic"
 * provider = "openai"
 * model = "text-embedding-3-small"
 * dimensions = 1536
 *
 * [memory]
 * embedding_model = "hint:semantic"
 * ```
 */
export interface EmbeddingRouteConfig {
  /**
   * Optional API key override for this route's provider
   */
  api_key?: string | null;
  /**
   * Optional embedding dimension override for this route
   */
  dimensions?: number | null;
  /**
   * Route hint name (e.g. "semantic", "archive", "faq")
   */
  hint: string;
  /**
   * Embedding model to use with that provider
   */
  model: string;
  /**
   * Embedding provider (`none`, `openai`, or `custom:<url>`)
   */
  provider: string;
  [k: string]: unknown;
}
/**
 * Gateway server configuration: host, port, pairing, rate limits (`[gateway]`).
 */
export interface GatewayConfig {
  /**
   * Allow binding to non-localhost without a tunnel (default: false)
   */
  allow_public_bind?: boolean;
  /**
   * Gateway host (default: 127.0.0.1)
   */
  host?: string;
  /**
   * Maximum distinct idempotency keys retained in memory.
   */
  idempotency_max_keys?: number;
  /**
   * TTL for webhook idempotency keys.
   */
  idempotency_ttl_secs?: number;
  node_control?: NodeControlConfig;
  /**
   * Max `/pair` requests per minute per client key.
   */
  pair_rate_limit_per_minute?: number;
  /**
   * Paired bearer tokens (managed automatically, not user-edited)
   */
  paired_tokens?: string[];
  /**
   * Gateway port (default: 42617)
   */
  port?: number;
  /**
   * Maximum distinct client keys tracked by gateway rate limiter maps.
   */
  rate_limit_max_keys?: number;
  /**
   * Require pairing before accepting requests (default: true)
   */
  require_pairing?: boolean;
  /**
   * Trust proxy-forwarded client IP headers (`X-Forwarded-For`, `X-Real-IP`).
   * Disabled by default; enable only behind a trusted reverse proxy.
   */
  trust_forwarded_headers?: boolean;
  /**
   * Max `/webhook` requests per minute per client key.
   */
  webhook_rate_limit_per_minute?: number;
  [k: string]: unknown;
}
/**
 * Node-control protocol scaffold (`[gateway.node_control]`).
 */
export interface NodeControlConfig {
  /**
   * Allowlist of remote node IDs for `node.describe`/`node.invoke`.
   * Empty means "no explicit allowlist" (accept all IDs).
   */
  allowed_node_ids?: string[];
  /**
   * Optional extra shared token for node-control API calls.
   * When set, clients must send this value in `X-Node-Control-Token`.
   */
  auth_token?: string | null;
  /**
   * Enable experimental node-control API endpoints.
   */
  enabled?: boolean;
  [k: string]: unknown;
}
/**
 * Goal loop configuration for autonomous long-term goal execution (`[goal_loop]`).
 */
export interface GoalLoopConfig {
  /**
   * Optional channel to deliver goal events to (e.g. "lark", "telegram").
   */
  channel?: string | null;
  /**
   * Enable autonomous goal execution. Default: `false`.
   */
  enabled: boolean;
  /**
   * Interval in minutes between goal loop cycles. Default: `10`.
   */
  interval_minutes: number;
  /**
   * Maximum steps to execute per cycle. Default: `3`.
   */
  max_steps_per_cycle: number;
  /**
   * Timeout in seconds for a single step execution. Default: `120`.
   */
  step_timeout_secs: number;
  /**
   * Optional recipient/chat_id for goal event delivery.
   */
  target?: string | null;
  [k: string]: unknown;
}
/**
 * Hardware configuration (wizard-driven physical world setup).
 */
export interface HardwareConfig {
  /**
   * Serial baud rate
   */
  baud_rate?: number;
  /**
   * Whether hardware access is enabled
   */
  enabled?: boolean;
  /**
   * Probe target chip (e.g. "STM32F401RE")
   */
  probe_target?: string | null;
  /**
   * Serial port path (e.g. "/dev/ttyACM0")
   */
  serial_port?: string | null;
  /**
   * Transport mode
   */
  transport?: "None" | "Native" | "Serial" | "Probe";
  /**
   * Enable workspace datasheet RAG (index PDF schematics for AI pin lookups)
   */
  workspace_datasheets?: boolean;
  [k: string]: unknown;
}
/**
 * Heartbeat configuration for periodic health pings (`[heartbeat]`).
 */
export interface HeartbeatConfig {
  /**
   * Skip duplicate task text within this cooldown window (minutes). Default: `0` (disabled).
   */
  dedupe_window_minutes?: number;
  /**
   * Enable periodic heartbeat pings. Default: `false`.
   */
  enabled: boolean;
  /**
   * Interval in minutes between heartbeat pings. Default: `30`.
   */
  interval_minutes: number;
  /**
   * Maximum heartbeat tasks to execute per tick. Default: `3`.
   */
  max_tasks_per_tick?: number;
  /**
   * Optional fallback task text when `HEARTBEAT.md` has no task entries.
   */
  message?: string | null;
  /**
   * Optional delivery channel for heartbeat output (for example: `telegram`).
   */
  target?: string | null;
  /**
   * Optional delivery recipient/chat identifier (required when `target` is set).
   */
  to?: string | null;
  [k: string]: unknown;
}
/**
 * Hooks configuration (lifecycle hooks and built-in hook toggles).
 */
export interface HooksConfig {
  builtin?: BuiltinHooksConfig;
  /**
   * Enable lifecycle hook execution.
   *
   * Hooks run in-process with the same privileges as the main runtime.
   * Keep enabled hook handlers narrowly scoped and auditable.
   */
  enabled: boolean;
  [k: string]: unknown;
}
export interface BuiltinHooksConfig {
  /**
   * Enable the boot-script hook (injects startup/runtime guidance).
   */
  boot_script?: boolean;
  /**
   * Enable the command-logger hook (logs tool calls for auditing).
   */
  command_logger?: boolean;
  /**
   * Enable the session-memory hook (persists session hints between turns).
   */
  session_memory?: boolean;
  [k: string]: unknown;
}
/**
 * HTTP request tool configuration (`[http_request]`).
 */
export interface HttpRequestConfig {
  /**
   * Allowed domains for HTTP requests (exact or subdomain match)
   */
  allowed_domains?: string[];
  /**
   * Optional named credential profiles for env-backed auth injection.
   *
   * Example:
   * `[http_request.credential_profiles.github]`
   * `env_var = "GITHUB_TOKEN"`
   * `header_name = "Authorization"`
   * `value_prefix = "Bearer "`
   */
  credential_profiles?: {
    [k: string]: HttpRequestCredentialProfile;
  };
  /**
   * Enable `http_request` tool for API interactions
   */
  enabled?: boolean;
  /**
   * Maximum response size in bytes (default: 1MB, 0 = unlimited)
   */
  max_response_size?: number;
  /**
   * Request timeout in seconds (default: 30)
   */
  timeout_secs?: number;
  /**
   * User-Agent string sent with HTTP requests (env: ZEROCLAW_HTTP_REQUEST_USER_AGENT)
   */
  user_agent?: string;
  [k: string]: unknown;
}
/**
 * HTTP request tool configuration (`[http_request]` section).
 *
 * Deny-by-default: if `allowed_domains` is empty, all HTTP requests are rejected.
 */
export interface HttpRequestCredentialProfile {
  /**
   * Environment variable containing the secret/token value
   */
  env_var?: string;
  /**
   * Header name to inject (for example `Authorization` or `X-API-Key`)
   */
  header_name?: string;
  /**
   * Optional prefix prepended to the secret (for example `Bearer `)
   */
  value_prefix?: string;
  [k: string]: unknown;
}
/**
 * Identity format configuration: OpenClaw or AIEOS (`[identity]`).
 */
export interface IdentityConfig {
  /**
   * Inline AIEOS JSON (alternative to file path)
   */
  aieos_inline?: string | null;
  /**
   * Path to AIEOS JSON file (relative to workspace)
   */
  aieos_path?: string | null;
  /**
   * Additional workspace files injected for the OpenClaw identity format.
   *
   * Paths are resolved relative to the workspace root.
   */
  extra_files?: string[];
  /**
   * Identity format: "openclaw" (default) or "aieos"
   */
  format?: string;
  [k: string]: unknown;
}
/**
 * External MCP server connections (`[mcp]`).
 */
export interface McpConfig {
  /**
   * Enable MCP tool loading.
   */
  enabled?: boolean;
  /**
   * Configured MCP servers.
   */
  servers?: McpServerConfig[];
  [k: string]: unknown;
}
/**
 * Configuration for a single external MCP server.
 */
export interface McpServerConfig {
  /**
   * Command arguments for stdio transport.
   */
  args?: string[];
  /**
   * Executable to spawn for stdio transport.
   */
  command?: string;
  /**
   * Optional environment variables for stdio transport.
   */
  env?: {
    [k: string]: string;
  };
  /**
   * Optional HTTP headers for HTTP/SSE transports.
   */
  headers?: {
    [k: string]: string;
  };
  /**
   * Display name used as a tool prefix (`<server>__<tool>`).
   */
  name: string;
  /**
   * Optional per-call timeout in seconds (hard capped in validation).
   */
  tool_timeout_secs?: number | null;
  /**
   * Transport type (default: stdio).
   */
  transport?: "stdio" | "http" | "sse";
  /**
   * URL for HTTP/SSE transports.
   */
  url?: string | null;
  [k: string]: unknown;
}
/**
 * Memory backend configuration: sqlite, markdown, embeddings (`[memory]`).
 */
export interface MemoryConfig {
  /**
   * Archive daily/session files older than this many days
   */
  archive_after_days?: number;
  /**
   * Auto-hydrate from MEMORY_SNAPSHOT.md when brain.db is missing
   */
  auto_hydrate?: boolean;
  /**
   * Auto-save user-stated conversation input to memory (assistant output is excluded)
   */
  auto_save: boolean;
  /**
   * "sqlite" | "sqlite_qdrant_hybrid" | "lucid" | "postgres" | "qdrant" | "markdown" | "none" (`none` = explicit no-op memory)
   *
   * `postgres` requires `[storage.provider.config]` with `db_url` (`dbURL` alias supported).
   * `qdrant` and `sqlite_qdrant_hybrid` use `[memory.qdrant]` config or `QDRANT_URL` env var.
   */
  backend: string;
  /**
   * Max tokens per chunk for document splitting
   */
  chunk_max_tokens?: number;
  /**
   * For sqlite backend: prune conversation rows older than this many days
   */
  conversation_retention_days?: number;
  /**
   * Max embedding cache entries before LRU eviction
   */
  embedding_cache_size?: number;
  /**
   * Embedding vector dimensions
   */
  embedding_dimensions?: number;
  /**
   * Embedding model name (e.g. "text-embedding-3-small")
   */
  embedding_model?: string;
  /**
   * Embedding provider: "none" | "openai" | "custom:URL"
   */
  embedding_provider?: string;
  /**
   * Run memory/session hygiene (archiving + retention cleanup)
   */
  hygiene_enabled?: boolean;
  /**
   * Weight for keyword BM25 in hybrid search (0.0–1.0)
   */
  keyword_weight?: number;
  /**
   * Minimum hybrid score (0.0–1.0) for a memory to be included in context.
   * Memories scoring below this threshold are dropped to prevent irrelevant
   * context from bleeding into conversations. Default: 0.4
   */
  min_relevance_score?: number;
  /**
   * Purge archived files older than this many days
   */
  purge_after_days?: number;
  qdrant?: QdrantConfig;
  /**
   * Enable LLM response caching to avoid paying for duplicate prompts
   */
  response_cache_enabled?: boolean;
  /**
   * Max number of cached responses before LRU eviction (default: 5000)
   */
  response_cache_max_entries?: number;
  /**
   * TTL in minutes for cached responses (default: 60)
   */
  response_cache_ttl_minutes?: number;
  /**
   * Enable periodic export of core memories to MEMORY_SNAPSHOT.md
   */
  snapshot_enabled?: boolean;
  /**
   * Run snapshot during hygiene passes (heartbeat-driven)
   */
  snapshot_on_hygiene?: boolean;
  /**
   * SQLite journal mode: "wal" (default) or "delete".
   *
   * WAL (Write-Ahead Logging) provides better concurrency and is the
   * recommended default. However, WAL requires shared-memory support
   * (mmap/shm) which is **not available** on many network and virtual
   * shared filesystems (NFS, SMB/CIFS, UTM/VirtioFS, VirtualBox shared
   * folders, etc.), causing `xShmMap` I/O errors at startup.
   *
   * Set to `"delete"` when your workspace lives on such a filesystem.
   *
   * Example:
   * ```toml
   * [memory]
   * sqlite_journal_mode = "delete"
   * ```
   */
  sqlite_journal_mode?: string;
  /**
   * For sqlite backend: max seconds to wait when opening the DB (e.g. file locked).
   * None = wait indefinitely (default). Recommended max: 300.
   */
  sqlite_open_timeout_secs?: number | null;
  /**
   * Weight for vector similarity in hybrid search (0.0–1.0)
   */
  vector_weight?: number;
  [k: string]: unknown;
}
/**
 * Configuration for Qdrant vector database backend.
 * Used when `backend = "qdrant"` or `backend = "sqlite_qdrant_hybrid"`.
 */
export interface QdrantConfig {
  /**
   * Optional API key for Qdrant Cloud or secured instances.
   * Falls back to `QDRANT_API_KEY` env var if not set.
   */
  api_key?: string | null;
  /**
   * Qdrant collection name for storing memories.
   * Falls back to `QDRANT_COLLECTION` env var, or default "zeroclaw_memories".
   */
  collection?: string;
  /**
   * Qdrant server URL (e.g. "http://localhost:6333").
   * Falls back to `QDRANT_URL` env var if not set.
   */
  url?: string | null;
  [k: string]: unknown;
}
/**
 * Named provider profile definition compatible with Codex app-server style config.
 */
export interface ModelProviderConfig {
  /**
   * Optional profile-scoped API key.
   */
  api_key?: string | null;
  /**
   * Optional custom authentication header for `custom:` providers
   * (for example `api-key` for Azure OpenAI).
   *
   * Contract:
   * - Default/omitted (`None`): uses the standard `Authorization: Bearer <token>` header.
   * - Compatibility: this key is additive and optional; older runtimes that do not support it
   *   ignore the field while continuing to use Bearer auth behavior.
   * - Rollback/migration: remove `auth_header` to return to Bearer-only auth if operators
   *   need to downgrade or revert custom-header behavior.
   */
  auth_header?: string | null;
  /**
   * Optional base URL for OpenAI-compatible endpoints.
   */
  base_url?: string | null;
  /**
   * Optional profile-scoped default model.
   */
  default_model?: string | null;
  /**
   * Optional provider type/name override (e.g. "openai", "openai-codex", or custom profile id).
   */
  name?: string | null;
  /**
   * If true, load OpenAI auth material (OPENAI_API_KEY or ~/.codex/auth.json).
   */
  requires_openai_auth?: boolean;
  /**
   * Provider protocol variant ("responses" or "chat_completions").
   */
  wire_api?: string | null;
  [k: string]: unknown;
}
/**
 * Route a task hint to a specific provider + model.
 *
 * ```toml
 * [[model_routes]]
 * hint = "reasoning"
 * provider = "openrouter"
 * model = "anthropic/claude-opus-4-20250514"
 *
 * [[model_routes]]
 * hint = "fast"
 * provider = "groq"
 * model = "llama-3.3-70b-versatile"
 * ```
 *
 * Usage: pass `hint:reasoning` as the model parameter to route the request.
 */
export interface ModelRouteConfig {
  /**
   * Optional API key override for this route's provider
   */
  api_key?: string | null;
  /**
   * Task hint name (e.g. "reasoning", "fast", "code", "summarize")
   */
  hint: string;
  /**
   * Optional max_tokens override for this route.
   * When set, provider requests cap output tokens to this value.
   */
  max_tokens?: number | null;
  /**
   * Model to use with that provider
   */
  model: string;
  /**
   * Provider to route to (must match a known provider name)
   */
  provider: string;
  /**
   * Optional route-specific transport override for this route.
   * Supported values: "auto", "websocket", "sse".
   *
   * When `model_routes[].transport` is unset, the route inherits `provider.transport`.
   * If both are unset, runtime defaults are used (`auto` for OpenAI Codex).
   * Existing configs without this field remain valid.
   */
  transport?: string | null;
  [k: string]: unknown;
}
/**
 * Multimodal (image) handling configuration (`[multimodal]`).
 */
export interface MultimodalConfig {
  /**
   * Allow fetching remote image URLs (http/https). Disabled by default.
   */
  allow_remote_fetch?: boolean;
  /**
   * Maximum image payload size in MiB before base64 encoding.
   */
  max_image_size_mb?: number;
  /**
   * Maximum number of image attachments accepted per request.
   */
  max_images?: number;
  [k: string]: unknown;
}
/**
 * Observability backend configuration (`[observability]`).
 */
export interface ObservabilityConfig {
  /**
   * "none" | "log" | "prometheus" | "otel"
   */
  backend: string;
  /**
   * OTLP endpoint (e.g. "http://localhost:4318"). Only used when backend = "otel".
   */
  otel_endpoint?: string | null;
  /**
   * Service name reported to the OTel collector. Defaults to "zeroclaw".
   */
  otel_service_name?: string | null;
  /**
   * Maximum entries retained when runtime_trace_mode = "rolling".
   */
  runtime_trace_max_entries?: number;
  /**
   * Runtime trace storage mode: "none" | "rolling" | "full".
   * Controls whether model replies and tool-call diagnostics are persisted.
   */
  runtime_trace_mode?: string;
  /**
   * Runtime trace file path. Relative paths are resolved under workspace_dir.
   */
  runtime_trace_path?: string;
  [k: string]: unknown;
}
/**
 * Peripheral board configuration for hardware integration (`[peripherals]`).
 */
export interface PeripheralsConfig {
  /**
   * Board configurations (nucleo-f401re, rpi-gpio, etc.)
   */
  boards?: PeripheralBoardConfig[];
  /**
   * Path to datasheet docs (relative to workspace) for RAG retrieval.
   * Place .md/.txt files named by board (e.g. nucleo-f401re.md, rpi-gpio.md).
   */
  datasheet_dir?: string | null;
  /**
   * Enable peripheral support (boards become agent tools)
   */
  enabled?: boolean;
  [k: string]: unknown;
}
/**
 * Configuration for a single peripheral board (e.g. STM32, RPi GPIO).
 */
export interface PeripheralBoardConfig {
  /**
   * Baud rate for serial (default: 115200)
   */
  baud?: number;
  /**
   * Board type: "nucleo-f401re", "rpi-gpio", "esp32", etc.
   */
  board: string;
  /**
   * Path for serial: "/dev/ttyACM0", "/dev/ttyUSB0"
   */
  path?: string | null;
  /**
   * Transport: "serial", "native", "websocket"
   */
  transport?: string;
  [k: string]: unknown;
}
/**
 * Plugin system configuration (discovery, loading, per-plugin config).
 */
export interface PluginsConfig {
  /**
   * Allowlist — if non-empty, only plugins with these IDs are loaded.
   * An empty list means all discovered plugins are eligible.
   */
  allow?: string[];
  /**
   * Denylist — plugins with these IDs are never loaded, even if in the allowlist.
   */
  deny?: string[];
  /**
   * Master switch — set to `false` to disable all plugin loading. Default: `true`.
   */
  enabled?: boolean;
  /**
   * Per-plugin configuration entries.
   */
  entries?: {
    [k: string]: PluginEntryConfig;
  };
  /**
   * Extra directories to scan for plugins (in addition to the standard locations).
   * Standard locations: `<binary_dir>/extensions/`, `~/.zeroclaw/extensions/`,
   * `<workspace>/.zeroclaw/extensions/`.
   */
  load_paths?: string[];
  [k: string]: unknown;
}
/**
 * Per-plugin configuration entry (`[plugins.entries.<id>]`).
 */
export interface PluginEntryConfig {
  /**
   * Plugin-specific configuration table, passed to `PluginApi::plugin_config()`.
   */
  config?: {
    [k: string]: unknown;
  };
  /**
   * Override the plugin's enabled state. If absent, the plugin is enabled
   * unless it is bundled-and-disabled-by-default.
   */
  enabled?: boolean | null;
  [k: string]: unknown;
}
/**
 * Provider-specific behavior overrides (`[provider]`).
 */
export interface ProviderConfig {
  /**
   * Optional reasoning level override for providers that support explicit levels
   * (e.g. OpenAI Codex `/responses` reasoning effort).
   */
  reasoning_level?: string | null;
  /**
   * Optional transport override for providers that support multiple transports.
   * Supported values: "auto", "websocket", "sse".
   *
   * Resolution order:
   * 1) `model_routes[].transport` (route-specific)
   * 2) env overrides (`PROVIDER_TRANSPORT`, `ZEROCLAW_PROVIDER_TRANSPORT`, `ZEROCLAW_CODEX_TRANSPORT`)
   * 3) `provider.transport`
   * 4) runtime default (`auto`, WebSocket-first with SSE fallback for OpenAI Codex)
   *
   * Note: env overrides replace configured `provider.transport` when set.
   *
   * Existing configs that omit `provider.transport` remain valid and fall back to defaults.
   */
  transport?: string | null;
  [k: string]: unknown;
}
/**
 * Proxy configuration for outbound HTTP/HTTPS/SOCKS5 traffic (`[proxy]`).
 */
export interface ProxyConfig {
  /**
   * Fallback proxy URL for all schemes.
   */
  all_proxy?: string | null;
  /**
   * Enable proxy support for selected scope.
   */
  enabled?: boolean;
  /**
   * Proxy URL for HTTP requests (supports http, https, socks5, socks5h).
   */
  http_proxy?: string | null;
  /**
   * Proxy URL for HTTPS requests (supports http, https, socks5, socks5h).
   */
  https_proxy?: string | null;
  /**
   * No-proxy bypass list. Same format as NO_PROXY.
   */
  no_proxy?: string[];
  /**
   * Proxy application scope.
   */
  scope?: "environment" | "zeroclaw" | "services";
  /**
   * Service selectors used when scope = "services".
   */
  services?: string[];
  [k: string]: unknown;
}
/**
 * Automatic query classification — maps user messages to model hints.
 */
export interface QueryClassificationConfig {
  /**
   * Enable automatic query classification. Default: `false`.
   */
  enabled?: boolean;
  /**
   * Classification rules evaluated in priority order.
   */
  rules?: ClassificationRule[];
  [k: string]: unknown;
}
/**
 * A single classification rule mapping message patterns to a model hint.
 */
export interface ClassificationRule {
  /**
   * Must match a `[[model_routes]]` hint value.
   */
  hint: string;
  /**
   * Case-insensitive substring matches.
   */
  keywords?: string[];
  /**
   * Only match if message length <= N chars.
   */
  max_length?: number | null;
  /**
   * Only match if message length >= N chars.
   */
  min_length?: number | null;
  /**
   * Case-sensitive literal matches (for "```", "fn ", etc.).
   */
  patterns?: string[];
  /**
   * Higher priority rules are checked first.
   */
  priority?: number;
  [k: string]: unknown;
}
/**
 * Reliability settings: retries, fallback providers, backoff (`[reliability]`).
 */
export interface ReliabilityConfig {
  /**
   * Additional API keys for round-robin rotation on rate-limit (429) errors.
   * The primary `api_key` is always tried first; these are extras.
   */
  api_keys?: string[];
  /**
   * Initial backoff for channel/daemon restarts.
   */
  channel_initial_backoff_secs?: number;
  /**
   * Max backoff for channel/daemon restarts.
   */
  channel_max_backoff_secs?: number;
  /**
   * Optional per-fallback provider API keys keyed by fallback entry name.
   * This allows distinct credentials for multiple `custom:<url>` endpoints.
   *
   * Contract:
   * - Default/omitted (`{}` via `#[serde(default)]`): no per-entry override is used.
   * - Compatibility: additive and non-breaking for existing configs that omit this field.
   * - Rollback/migration: remove this map (or specific entries) to revert to provider/env-based
   *   credential resolution.
   */
  fallback_api_keys?: {
    [k: string]: string;
  };
  /**
   * Fallback provider chain (e.g. `["anthropic", "openai"]`).
   */
  fallback_providers?: string[];
  /**
   * Per-model fallback chains. When a model fails, try these alternatives in order.
   * Example: `{ "claude-opus-4-20250514" = ["claude-sonnet-4-20250514", "gpt-4o"] }`
   *
   * Compatibility behavior: keys matching configured provider names are treated
   * as provider-scoped remap chains during provider fallback.
   */
  model_fallbacks?: {
    [k: string]: string[];
  };
  /**
   * Base backoff (ms) for provider retry delay.
   */
  provider_backoff_ms?: number;
  /**
   * Retries per provider before failing over.
   */
  provider_retries?: number;
  /**
   * Scheduler polling cadence in seconds.
   */
  scheduler_poll_secs?: number;
  /**
   * Max retries for cron job execution attempts.
   */
  scheduler_retries?: number;
  [k: string]: unknown;
}
/**
 * Research phase configuration (`[research]`). Proactive information gathering.
 */
export interface ResearchPhaseConfig {
  /**
   * Enable the research phase.
   */
  enabled?: boolean;
  /**
   * Keywords that trigger research phase (when `trigger = "keywords"`).
   */
  keywords?: string[];
  /**
   * Maximum tool call iterations during research phase.
   */
  max_iterations?: number;
  /**
   * Minimum message length to trigger research (when `trigger = "length"`).
   */
  min_message_length?: number;
  /**
   * Show detailed progress during research (tool calls, results).
   */
  show_progress?: boolean;
  /**
   * Custom system prompt prefix for research phase.
   * If empty, uses default research instructions.
   */
  system_prompt_prefix?: string;
  /**
   * When to trigger research phase.
   */
  trigger?: "never" | "always" | "keywords" | "length" | "question";
  [k: string]: unknown;
}
/**
 * Runtime adapter configuration (`[runtime]`). Controls native vs Docker execution.
 */
export interface RuntimeConfig {
  docker?: DockerRuntimeConfig;
  /**
   * Runtime kind (`native` | `docker` | `wasm`).
   */
  kind?: string;
  /**
   * Global reasoning override for providers that expose explicit controls.
   * - `None`: provider default behavior
   * - `Some(true)`: request reasoning/thinking when supported
   * - `Some(false)`: disable reasoning/thinking when supported
   */
  reasoning_enabled?: boolean | null;
  /**
   * Deprecated compatibility alias for `[provider].reasoning_level`.
   * - Canonical key: `provider.reasoning_level`
   * - Legacy key accepted for compatibility: `runtime.reasoning_level`
   * - When both are set, provider-level value wins.
   */
  reasoning_level?: string | null;
  wasm?: WasmRuntimeConfig;
  [k: string]: unknown;
}
/**
 * Docker runtime settings (used when `kind = "docker"`).
 */
export interface DockerRuntimeConfig {
  /**
   * Optional workspace root allowlist for Docker mount validation.
   */
  allowed_workspace_roots?: string[];
  /**
   * Optional CPU limit (`None` = no explicit limit).
   */
  cpu_limit?: number | null;
  /**
   * Runtime image used to execute shell commands.
   */
  image?: string;
  /**
   * Optional memory limit in MB (`None` = no explicit limit).
   */
  memory_limit_mb?: number | null;
  /**
   * Mount configured workspace into `/workspace`.
   */
  mount_workspace?: boolean;
  /**
   * Docker network mode (`none`, `bridge`, etc.).
   */
  network?: string;
  /**
   * Mount root filesystem as read-only.
   */
  read_only_rootfs?: boolean;
  [k: string]: unknown;
}
/**
 * WASM runtime settings (used when `kind = "wasm"`).
 */
export interface WasmRuntimeConfig {
  /**
   * Allow reading files from workspace inside WASM host calls (future-facing).
   */
  allow_workspace_read?: boolean;
  /**
   * Allow writing files to workspace inside WASM host calls (future-facing).
   */
  allow_workspace_write?: boolean;
  /**
   * Explicit host allowlist for outbound HTTP from WASM modules (future-facing).
   */
  allowed_hosts?: string[];
  /**
   * Fuel limit per invocation (instruction budget).
   */
  fuel_limit?: number;
  /**
   * Maximum `.wasm` module size in MB.
   */
  max_module_size_mb?: number;
  /**
   * Memory limit per invocation in MB.
   */
  memory_limit_mb?: number;
  security?: WasmSecurityConfig;
  /**
   * Workspace-relative directory that stores `.wasm` modules.
   */
  tools_dir?: string;
  [k: string]: unknown;
}
/**
 * WASM runtime security controls (`[runtime.wasm.security]` section).
 */
export interface WasmSecurityConfig {
  /**
   * Capability escalation handling policy.
   */
  capability_escalation_mode?: "deny" | "clamp";
  /**
   * Module digest verification policy.
   */
  module_hash_policy?: "disabled" | "warn" | "enforce";
  /**
   * Optional pinned SHA-256 digest map keyed by module name (without `.wasm`).
   */
  module_sha256?: {
    [k: string]: string;
  };
  /**
   * Reject module files that are symlinks before execution.
   */
  reject_symlink_modules?: boolean;
  /**
   * Reject `runtime.wasm.tools_dir` when it is itself a symlink.
   */
  reject_symlink_tools_dir?: boolean;
  /**
   * Require `runtime.wasm.tools_dir` to stay workspace-relative and traversal-free.
   */
  require_workspace_relative_tools_dir?: boolean;
  /**
   * Strictly validate host allowlist entries (`host` or `host:port` only).
   */
  strict_host_validation?: boolean;
  [k: string]: unknown;
}
/**
 * Scheduler configuration for periodic task execution (`[scheduler]`).
 */
export interface SchedulerConfig {
  /**
   * Enable the built-in scheduler loop.
   */
  enabled?: boolean;
  /**
   * Maximum tasks executed per scheduler polling cycle.
   */
  max_concurrent?: number;
  /**
   * Maximum number of persisted scheduled tasks.
   */
  max_tasks?: number;
  [k: string]: unknown;
}
/**
 * Secrets encryption configuration (`[secrets]`).
 */
export interface SecretsConfig {
  /**
   * Enable encryption for API keys and tokens in config.toml
   */
  encrypt?: boolean;
  [k: string]: unknown;
}
/**
 * Security subsystem configuration (`[security]`).
 */
export interface SecurityConfig {
  audit?: AuditConfig;
  /**
   * Enable per-turn canary tokens to detect system-context exfiltration.
   */
  canary_tokens?: boolean;
  estop?: EstopConfig;
  otp?: OtpConfig;
  outbound_leak_guard?: OutboundLeakGuardConfig;
  perplexity_filter?: PerplexityFilterConfig;
  resources?: ResourceLimitsConfig;
  /**
   * Custom security role definitions used for user-level tool authorization.
   */
  roles?: SecurityRoleConfig[];
  sandbox?: SandboxConfig;
  /**
   * Enable semantic prompt-injection guard backed by vector similarity.
   *
   * This guard is additive to lexical prompt detection and only runs when
   * `PromptGuard` does not already block the input.
   */
  semantic_guard?: boolean;
  /**
   * Qdrant collection used by the semantic guard.
   */
  semantic_guard_collection?: string;
  /**
   * Cosine similarity threshold for semantic-guard detections.
   */
  semantic_guard_threshold?: number;
  syscall_anomaly?: SyscallAnomalyConfig;
  url_access?: UrlAccessConfig;
  [k: string]: unknown;
}
/**
 * Audit logging configuration
 */
export interface AuditConfig {
  /**
   * Enable audit logging
   */
  enabled?: boolean;
  /**
   * Path to audit log file (relative to zeroclaw dir)
   */
  log_path?: string;
  /**
   * Maximum log size in MB before rotation
   */
  max_size_mb?: number;
  /**
   * Sign events with HMAC for tamper evidence
   */
  sign_events?: boolean;
  [k: string]: unknown;
}
/**
 * Emergency-stop state machine configuration.
 */
export interface EstopConfig {
  /**
   * Enable emergency stop controls.
   */
  enabled?: boolean;
  /**
   * Require a valid OTP before resume operations.
   */
  require_otp_to_resume?: boolean;
  /**
   * File path used to persist estop state.
   */
  state_file?: string;
}
/**
 * OTP gating configuration for sensitive actions/domains.
 */
export interface OtpConfig {
  /**
   * Reuse window for recently validated OTP codes.
   */
  cache_valid_secs?: number;
  /**
   * Delivery mode for OTP challenge prompts in chat channels.
   */
  challenge_delivery?: "dm" | "thread" | "ephemeral";
  /**
   * Maximum OTP attempts allowed per challenge.
   */
  challenge_max_attempts?: number;
  /**
   * Maximum time a challenge remains valid, in seconds.
   */
  challenge_timeout_secs?: number;
  /**
   * Enable OTP gating. Defaults to enabled.
   */
  enabled?: boolean;
  /**
   * Tool/action names gated by OTP.
   */
  gated_actions?: string[];
  /**
   * Domain-category presets expanded into `gated_domains`.
   */
  gated_domain_categories?: string[];
  /**
   * Explicit domain patterns gated by OTP.
   */
  gated_domains?: string[];
  /**
   * OTP method.
   */
  method?: "totp" | "pairing" | "cli-prompt";
  /**
   * TOTP time-step in seconds.
   */
  token_ttl_secs?: number;
}
/**
 * Outbound credential leak guard for channel replies.
 */
export interface OutboundLeakGuardConfig {
  /**
   * Action to take when potential credentials are detected.
   */
  action?: "redact" | "block";
  /**
   * Enable outbound credential leak scanning for channel responses.
   */
  enabled?: boolean;
  /**
   * Detection sensitivity (0.0-1.0, higher = more aggressive).
   */
  sensitivity?: number;
}
/**
 * Lightweight statistical filter for adversarial suffixes (opt-in).
 */
export interface PerplexityFilterConfig {
  /**
   * Enable probabilistic adversarial suffix filtering before provider calls.
   */
  enable_perplexity_filter?: boolean;
  /**
   * Minimum input length before running the perplexity filter.
   */
  min_prompt_chars?: number;
  /**
   * Character-class bigram perplexity threshold for anomaly blocking.
   */
  perplexity_threshold?: number;
  /**
   * Number of trailing characters sampled for suffix anomaly scoring.
   */
  suffix_window_chars?: number;
  /**
   * Minimum punctuation ratio in the sampled suffix required to block.
   */
  symbol_ratio_threshold?: number;
  [k: string]: unknown;
}
/**
 * Resource limits
 */
export interface ResourceLimitsConfig {
  /**
   * Maximum CPU time in seconds per command
   */
  max_cpu_time_seconds?: number;
  /**
   * Maximum memory in MB per command
   */
  max_memory_mb?: number;
  /**
   * Maximum number of subprocesses
   */
  max_subprocesses?: number;
  /**
   * Enable memory monitoring
   */
  memory_monitoring?: boolean;
  [k: string]: unknown;
}
/**
 * Custom role definition for user-level authorization.
 */
export interface SecurityRoleConfig {
  /**
   * Explicit allowlist of tools for this role.
   */
  allowed_tools?: string[];
  /**
   * Explicit denylist of tools for this role.
   */
  denied_tools?: string[];
  /**
   * Optional human-readable description.
   */
  description?: string;
  /**
   * Role-scoped domain categories requiring OTP.
   */
  gated_domain_categories?: string[];
  /**
   * Role-scoped domain patterns requiring OTP.
   */
  gated_domains?: string[];
  /**
   * Optional parent role name used for inheritance.
   */
  inherits?: string | null;
  /**
   * Stable role name used by user records.
   */
  name: string;
  /**
   * Tool names requiring OTP for this role.
   */
  totp_gated?: string[];
}
/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  /**
   * Sandbox backend to use
   */
  backend?: "auto" | "landlock" | "firejail" | "bubblewrap" | "docker" | "none";
  /**
   * Enable sandboxing (None = auto-detect, Some = explicit)
   */
  enabled?: boolean | null;
  /**
   * Custom Firejail arguments (when backend = firejail)
   */
  firejail_args?: string[];
  [k: string]: unknown;
}
/**
 * Syscall anomaly detection profile for daemon shell/process execution.
 */
export interface SyscallAnomalyConfig {
  /**
   * Cooldown between identical anomaly alerts (seconds).
   */
  alert_cooldown_secs?: number;
  /**
   * Emit anomaly alerts when a syscall appears outside the expected baseline.
   */
  alert_on_unknown_syscall?: boolean;
  /**
   * Expected syscall baseline. Unknown syscall names trigger anomaly when enabled.
   */
  baseline_syscalls?: string[];
  /**
   * Enable syscall anomaly detection.
   */
  enabled?: boolean;
  /**
   * Path to syscall anomaly log file (relative to ~/.zeroclaw unless absolute).
   */
  log_path?: string;
  /**
   * Maximum anomaly alerts emitted per rolling minute (global guardrail).
   */
  max_alerts_per_minute?: number;
  /**
   * Allowed denied-syscall events per rolling minute before triggering an alert.
   */
  max_denied_events_per_minute?: number;
  /**
   * Allowed total syscall telemetry events per rolling minute before triggering an alert.
   */
  max_total_events_per_minute?: number;
  /**
   * Treat denied syscall lines as anomalies even when syscall is in baseline.
   */
  strict_mode?: boolean;
  [k: string]: unknown;
}
/**
 * Shared URL access policy for network-enabled tools.
 */
export interface UrlAccessConfig {
  /**
   * Explicit CIDR ranges that bypass private/local-IP blocking.
   */
  allow_cidrs?: string[];
  /**
   * Explicit domain patterns that bypass private/local-IP blocking.
   * Supports exact, `*.example.com`, and `*`.
   */
  allow_domains?: string[];
  /**
   * Allow loopback host/IP access (`localhost`, `127.0.0.1`, `::1`).
   */
  allow_loopback?: boolean;
  /**
   * Persisted first-visit approvals granted by a human operator.
   * Supports exact, `*.example.com`, and `*`.
   */
  approved_domains?: string[];
  /**
   * Block private/local IPs and hostnames by default.
   */
  block_private_ip?: boolean;
  /**
   * Global trusted domain allowlist shared by all URL-based network tools.
   * Supports exact, `*.example.com`, and `*`.
   */
  domain_allowlist?: string[];
  /**
   * Global domain blocklist shared by all URL-based network tools.
   * Supports exact, `*.example.com`, and `*`. Takes priority over allowlists.
   */
  domain_blocklist?: string[];
  /**
   * Enforce a global domain allowlist in addition to per-tool allowlists.
   * When enabled, hosts must match `domain_allowlist`.
   */
  enforce_domain_allowlist?: boolean;
  /**
   * Require explicit human confirmation before first-time access to an
   * unseen domain. Confirmed domains are persisted in `approved_domains`.
   */
  require_first_visit_approval?: boolean;
}
/**
 * Skills loading and community repository behavior (`[skills]`).
 */
export interface SkillsConfig {
  /**
   * Allow script-like files in skills (`.sh`, `.bash`, `.ps1`, shebang shell files).
   * Default: `false` (secure by default).
   */
  allow_scripts?: boolean;
  /**
   * Optional ClawhHub API token for authenticated skill downloads.
   * Obtain from https://clawhub.ai after signing in.
   * Set via config: `clawhub_token = "..."` under `[skills]`.
   */
  clawhub_token?: string | null;
  /**
   * Optional path to a local open-skills repository.
   * If unset, defaults to `$HOME/open-skills` when enabled.
   */
  open_skills_dir?: string | null;
  /**
   * Enable loading and syncing the community open-skills repository.
   * Default: `false` (opt-in).
   */
  open_skills_enabled?: boolean;
  /**
   * Controls how skills are injected into the system prompt.
   * `compact` (default) keeps context small and loads skills on demand.
   * `full` preserves legacy behavior as an opt-in.
   */
  prompt_injection_mode?: "compact" | "full";
  /**
   * Optional allowlist of canonical directory roots for workspace skill symlink targets.
   * Symlinked workspace skills are rejected unless their resolved targets are under one
   * of these roots. Accepts absolute paths and `~/` home-relative paths.
   */
  trusted_skill_roots?: string[];
  [k: string]: unknown;
}
/**
 * Persistent storage provider configuration (`[storage]`).
 */
export interface StorageConfig {
  provider?: StorageProviderSection;
  [k: string]: unknown;
}
/**
 * Storage provider settings (e.g. sqlite, postgres).
 */
export interface StorageProviderSection {
  config?: StorageProviderConfig;
  [k: string]: unknown;
}
/**
 * Storage provider backend settings.
 */
export interface StorageProviderConfig {
  /**
   * Optional connection timeout in seconds for remote providers.
   */
  connect_timeout_secs?: number | null;
  /**
   * Connection URL for remote providers.
   * Accepts legacy aliases: dbURL, database_url, databaseUrl.
   */
  db_url?: string | null;
  /**
   * Storage engine key (e.g. "postgres", "sqlite").
   */
  provider?: string;
  /**
   * Database schema for SQL backends.
   */
  schema?: string;
  /**
   * Table name for memory entries.
   */
  table?: string;
  /**
   * Enable TLS for the PostgreSQL connection.
   *
   * `true` — require TLS (skips certificate verification; suitable for
   * self-signed certs and most managed databases).
   * `false` (default) — plain TCP, backward-compatible.
   */
  tls?: boolean;
  [k: string]: unknown;
}
/**
 * Voice transcription configuration (Whisper API via Groq).
 */
export interface TranscriptionConfig {
  /**
   * API key used for transcription requests.
   *
   * If unset, runtime falls back to `GROQ_API_KEY` for backward compatibility.
   */
  api_key?: string | null;
  /**
   * Whisper API endpoint URL.
   */
  api_url?: string;
  /**
   * Enable voice transcription for channels that support it.
   */
  enabled?: boolean;
  /**
   * Optional language hint (ISO-639-1, e.g. "en", "ru").
   */
  language?: string | null;
  /**
   * Maximum voice duration in seconds (messages longer than this are skipped).
   */
  max_duration_secs?: number;
  /**
   * Whisper model name.
   */
  model?: string;
  [k: string]: unknown;
}
/**
 * Tunnel configuration for exposing the gateway publicly (`[tunnel]`).
 */
export interface TunnelConfig {
  /**
   * Cloudflare Tunnel configuration (used when `provider = "cloudflare"`).
   */
  cloudflare?: CloudflareTunnelConfig | null;
  /**
   * Custom tunnel command configuration (used when `provider = "custom"`).
   */
  custom?: CustomTunnelConfig | null;
  /**
   * ngrok tunnel configuration (used when `provider = "ngrok"`).
   */
  ngrok?: NgrokTunnelConfig | null;
  /**
   * Tunnel provider: `"none"`, `"cloudflare"`, `"tailscale"`, `"ngrok"`, or `"custom"`. Default: `"none"`.
   */
  provider: string;
  /**
   * Tailscale Funnel/Serve configuration (used when `provider = "tailscale"`).
   */
  tailscale?: TailscaleTunnelConfig | null;
  [k: string]: unknown;
}
export interface CloudflareTunnelConfig {
  /**
   * Cloudflare Tunnel token (from Zero Trust dashboard)
   */
  token: string;
  [k: string]: unknown;
}
export interface CustomTunnelConfig {
  /**
   * Optional URL to check tunnel health
   */
  health_url?: string | null;
  /**
   * Command template to start the tunnel. Use {port} and {host} placeholders.
   * Example: "bore local {port} --to bore.pub"
   */
  start_command: string;
  /**
   * Optional regex to extract public URL from command stdout
   */
  url_pattern?: string | null;
  [k: string]: unknown;
}
export interface NgrokTunnelConfig {
  /**
   * ngrok auth token
   */
  auth_token: string;
  /**
   * Optional custom domain
   */
  domain?: string | null;
  [k: string]: unknown;
}
export interface TailscaleTunnelConfig {
  /**
   * Use Tailscale Funnel (public internet) vs Serve (tailnet only)
   */
  funnel?: boolean;
  /**
   * Optional hostname override
   */
  hostname?: string | null;
  [k: string]: unknown;
}
/**
 * WASM plugin engine configuration (`[wasm]` section).
 */
export interface WasmConfig {
  /**
   * Enable loading WASM tools from installed skill packages.
   * Default: `true` (auto-discovers plugins in the skills directory).
   */
  enabled?: boolean;
  /**
   * CPU fuel budget per invocation (roughly one unit ≈ one WASM instruction).
   * Default: 1_000_000_000.
   */
  fuel_limit?: number;
  /**
   * Maximum linear memory per WASM invocation in MiB.
   * Valid range: 1..=256. Default: `64`.
   */
  memory_limit_mb?: number;
  /**
   * URL of the ZeroMarket (or compatible) registry used by `zeroclaw skill install`.
   * Default: the public ZeroMarket registry.
   */
  registry_url?: string;
  [k: string]: unknown;
}
/**
 * Web fetch tool configuration (`[web_fetch]`).
 */
export interface WebFetchConfig {
  /**
   * Allowed domains for web fetch (exact or subdomain match; `["*"]` = all public hosts)
   */
  allowed_domains?: string[];
  /**
   * Optional provider API key (required for provider = "firecrawl" or "tavily").
   * Multiple keys can be comma-separated for round-robin load balancing.
   */
  api_key?: string | null;
  /**
   * Optional provider API URL override (for self-hosted providers)
   */
  api_url?: string | null;
  /**
   * Blocked domains (exact or subdomain match; always takes priority over allowed_domains)
   */
  blocked_domains?: string[];
  /**
   * Enable `web_fetch` tool for fetching web page content
   */
  enabled?: boolean;
  /**
   * Maximum response size in bytes (default: 500KB, plain text is much smaller than raw HTML)
   */
  max_response_size?: number;
  /**
   * Provider: "fast_html2md", "nanohtml2text", "firecrawl", or "tavily"
   */
  provider?: string;
  /**
   * Request timeout in seconds (default: 30)
   */
  timeout_secs?: number;
  /**
   * User-Agent string sent with fetch requests (env: ZEROCLAW_WEB_FETCH_USER_AGENT)
   */
  user_agent?: string;
  [k: string]: unknown;
}
/**
 * Web search tool configuration (`[web_search]`).
 */
export interface WebSearchConfig {
  /**
   * Generic provider API key (used by firecrawl, tavily, and as fallback for brave).
   * Multiple keys can be comma-separated for round-robin load balancing.
   */
  api_key?: string | null;
  /**
   * Optional provider API URL override (for self-hosted providers)
   */
  api_url?: string | null;
  /**
   * Brave Search API key (required if provider is "brave")
   */
  brave_api_key?: string | null;
  /**
   * Optional country filter forwarded to providers that support it (e.g. "US")
   */
  country?: string | null;
  /**
   * Optional domain filter forwarded to providers that support it
   */
  domain_filter?: string[];
  /**
   * Enable `web_search_tool` for web searches
   */
  enabled?: boolean;
  /**
   * Exa API key (used when provider is "exa")
   */
  exa_api_key?: string | null;
  /**
   * Include textual content payloads for Exa search responses
   */
  exa_include_text?: boolean;
  /**
   * Exa search type override: "auto" (default), "keyword", or "neural"
   */
  exa_search_type?: string;
  /**
   * Fallback providers attempted after primary provider fails.
   * Supported values: duckduckgo (or ddg), brave, firecrawl, tavily, perplexity, exa, jina
   */
  fallback_providers?: string[];
  /**
   * Jina API key (optional; can raise limits for provider = "jina")
   */
  jina_api_key?: string | null;
  /**
   * Optional site filters for Jina search provider
   */
  jina_site_filters?: string[];
  /**
   * Optional language filter forwarded to providers that support it
   */
  language_filter?: string[];
  /**
   * Maximum results per search (1-10)
   */
  max_results?: number;
  /**
   * Optional max tokens cap used by provider-specific APIs (for example Perplexity)
   */
  max_tokens?: number | null;
  /**
   * Optional per-result token cap used by provider-specific APIs
   */
  max_tokens_per_page?: number | null;
  /**
   * Perplexity API key (used when provider is "perplexity")
   */
  perplexity_api_key?: string | null;
  /**
   * Search provider: "duckduckgo"/"ddg" (free, no API key), "brave", "firecrawl",
   * "tavily", "perplexity", "exa", or "jina"
   */
  provider?: string;
  /**
   * Optional recency filter forwarded to providers that support it
   */
  recency_filter?: string | null;
  /**
   * Retry count per provider before falling back to next provider
   */
  retries_per_provider?: number;
  /**
   * Retry backoff in milliseconds between provider retry attempts
   */
  retry_backoff_ms?: number;
  /**
   * Request timeout in seconds
   */
  timeout_secs?: number;
  /**
   * User-Agent string sent with search requests (env: ZEROCLAW_WEB_SEARCH_USER_AGENT)
   */
  user_agent?: string;
  [k: string]: unknown;
}
