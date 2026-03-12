/* Auto-generated from zeroclaw-config.schema.json — do not edit */

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
  /**
   * API key for the selected provider. Overridden by `ZEROCLAW_API_KEY` or `API_KEY` env vars.
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
  default_temperature?: number;
  /**
   * Embedding routing rules — route `hint:<name>` to specific provider+model combos.
   */
  embedding_routes?: EmbeddingRouteConfig[];
  gateway?: GatewayConfig;
  hardware?: HardwareConfig;
  heartbeat?: HeartbeatConfig;
  hooks?: HooksConfig;
  http_request?: HttpRequestConfig;
  identity?: IdentityConfig;
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
  multimodal?: MultimodalConfig;
  observability?: ObservabilityConfig;
  peripherals?: PeripheralsConfig;
  proxy?: ProxyConfig;
  query_classification?: QueryClassificationConfig;
  reliability?: ReliabilityConfig;
  runtime?: RuntimeConfig;
  scheduler?: SchedulerConfig;
  secrets?: SecretsConfig;
  security?: SecurityConfig;
  skills?: SkillsConfig;
  storage?: StorageConfig;
  transcription?: TranscriptionConfig;
  tts?: TtsConfig;
  tunnel?: TunnelConfig;
  web_fetch?: WebFetchConfig;
  web_search?: WebSearchConfig;
  [k: string]: unknown;
}
/**
 * Agent orchestration settings (`[agent]`).
 */
export interface AgentConfig {
  /**
   * When true: bootstrap_max_chars=6000, rag_chunk_limit=2. Use for 13B or smaller models.
   */
  compact_context?: boolean;
  /**
   * Maximum conversation history messages retained per session. Default: `50`.
   */
  max_history_messages?: number;
  /**
   * Maximum tool-call loop turns per user message. Default: `10`.
   * Setting to `0` falls back to the safe default of `10`.
   */
  max_tool_iterations?: number;
  /**
   * Enable parallel tool execution within a single iteration. Default: `false`.
   */
  parallel_tools?: boolean;
  /**
   * Tool dispatch strategy (e.g. `"auto"`). Default: `"auto"`.
   */
  tool_dispatcher?: string;
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
 * Autonomy and security policy configuration (`[autonomy]`).
 */
export interface AutonomyConfig {
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
   * Tools to exclude from non-CLI channels (e.g. Telegram, Discord).
   *
   * When a tool is listed here, non-CLI channels will not expose it to the
   * model in tool specs.
   */
  non_cli_excluded_tools?: string[];
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
 * Browser automation configuration (`[browser]`).
 */
export interface BrowserConfig {
  /**
   * Allowed domains for `browser_open` (exact or subdomain match)
   */
  allowed_domains?: string[];
  /**
   * Browser automation backend: "agent_browser" | "rust_native" | "computer_use" | "auto"
   */
  backend?: string;
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
 * Email channel configuration
 */
export interface EmailConfig {
  /**
   * Allowed sender addresses/domains (empty = deny all, ["*"] = allow all)
   */
  allowed_senders?: string[];
  /**
   * Default subject line for outgoing emails (default: "ZeroClaw Message")
   */
  default_subject?: string;
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
   * Encrypt key for webhook message decryption (optional)
   */
  encrypt_key?: string | null;
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
   * Encrypt key for webhook message decryption (optional)
   */
  encrypt_key?: string | null;
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
   */
  channel_id?: string | null;
  [k: string]: unknown;
}
/**
 * Telegram bot channel configuration.
 */
export interface TelegramConfig {
  /**
   * Allowed Telegram user IDs or usernames. Empty = deny all.
   */
  allowed_users: string[];
  /**
   * Telegram Bot API token (from @BotFather).
   */
  bot_token: string;
  /**
   * Minimum interval (ms) between draft message edits to avoid rate limits.
   */
  draft_update_interval_ms?: number;
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
   * Streaming mode for progressive response delivery via message edits.
   */
  stream_mode?: "off" | "partial";
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
   * Enable periodic heartbeat pings. Default: `false`.
   */
  enabled: boolean;
  /**
   * Interval in minutes between heartbeat pings. Default: `30`.
   */
  interval_minutes: number;
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
   * Enable the command-logger hook (logs tool calls for auditing).
   */
  command_logger: boolean;
  webhook_audit?: WebhookAuditConfig;
  [k: string]: unknown;
}
/**
 * Configuration for the webhook-audit hook.
 *
 * When enabled, POSTs a JSON payload to `url` for every tool invocation
 * that matches one of `tool_patterns`.
 */
export interface WebhookAuditConfig {
  /**
   * Enable the webhook-audit hook. Default: `false`.
   */
  enabled?: boolean;
  /**
   * Include tool call arguments in the audit payload. Default: `false`.
   *
   * Be mindful of sensitive data — arguments may contain secrets or PII.
   */
  include_args?: boolean;
  /**
   * Maximum size (in bytes) of serialised arguments included in a single
   * audit payload. Arguments exceeding this limit are truncated.
   * Default: `4096`.
   */
  max_args_bytes?: number;
  /**
   * Glob patterns for tool names to audit (e.g. `["Bash", "Write"]`).
   * An empty list means **no** tools are audited.
   */
  tool_patterns?: string[];
  /**
   * Target URL that will receive the audit POST requests.
   */
  url?: string;
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
   * Identity format: "openclaw" (default) or "aieos"
   */
  format?: string;
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
   * "sqlite" | "lucid" | "postgres" | "qdrant" | "markdown" | "none" (`none` = explicit no-op memory)
   *
   * `postgres` requires `[storage.provider.config]` with `db_url` (`dbURL` alias supported).
   * `qdrant` uses `[memory.qdrant]` config or `QDRANT_URL` env var.
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
 * Only used when `backend = "qdrant"`.
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
   * Azure OpenAI API version (defaults to "2024-08-01-preview").
   */
  azure_openai_api_version?: string | null;
  /**
   * Azure OpenAI deployment name (e.g. "gpt-4o").
   */
  azure_openai_deployment?: string | null;
  /**
   * Azure OpenAI resource name (e.g. "my-resource" in https://my-resource.openai.azure.com).
   */
  azure_openai_resource?: string | null;
  /**
   * Optional base URL for OpenAI-compatible endpoints.
   */
  base_url?: string | null;
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
   * Model to use with that provider
   */
  model: string;
  /**
   * Provider to route to (must match a known provider name)
   */
  provider: string;
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
   * Fallback provider chain (e.g. `["anthropic", "openai"]`).
   */
  fallback_providers?: string[];
  /**
   * Per-model fallback chains. When a model fails, try these alternatives in order.
   * Example: `{ "claude-opus-4-20250514" = ["claude-sonnet-4-20250514", "gpt-4o"] }`
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
 * Runtime adapter configuration (`[runtime]`). Controls native vs Docker execution.
 */
export interface RuntimeConfig {
  docker?: DockerRuntimeConfig;
  /**
   * Runtime kind (`native` | `docker`).
   */
  kind?: string;
  /**
   * Global reasoning override for providers that expose explicit controls.
   * - `None`: provider default behavior
   * - `Some(true)`: request reasoning/thinking when supported
   * - `Some(false)`: disable reasoning/thinking when supported
   */
  reasoning_enabled?: boolean | null;
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
  estop?: EstopConfig;
  otp?: OtpConfig;
  resources?: ResourceLimitsConfig;
  sandbox?: SandboxConfig;
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
   * Enable OTP gating. Defaults to disabled for backward compatibility.
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
 * Skills loading and community repository behavior (`[skills]`).
 */
export interface SkillsConfig {
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
   * `full` preserves legacy behavior. `compact` keeps context small and loads skills on demand.
   */
  prompt_injection_mode?: "full" | "compact";
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
  [k: string]: unknown;
}
/**
 * Voice transcription configuration (Whisper API via Groq).
 */
export interface TranscriptionConfig {
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
 * Text-to-Speech configuration (`[tts]`).
 */
export interface TtsConfig {
  /**
   * Default audio output format (`"mp3"`, `"opus"`, `"wav"`).
   */
  default_format?: string;
  /**
   * Default TTS provider (`"openai"`, `"elevenlabs"`, `"google"`, `"edge"`).
   */
  default_provider?: string;
  /**
   * Default voice ID passed to the selected provider.
   */
  default_voice?: string;
  /**
   * Edge TTS provider configuration (`[tts.edge]`).
   */
  edge?: EdgeTtsConfig | null;
  /**
   * ElevenLabs TTS provider configuration (`[tts.elevenlabs]`).
   */
  elevenlabs?: ElevenLabsTtsConfig | null;
  /**
   * Enable TTS synthesis.
   */
  enabled?: boolean;
  /**
   * Google Cloud TTS provider configuration (`[tts.google]`).
   */
  google?: GoogleTtsConfig | null;
  /**
   * Maximum input text length in characters (default 4096).
   */
  max_text_length?: number;
  /**
   * OpenAI TTS provider configuration (`[tts.openai]`).
   */
  openai?: OpenAiTtsConfig | null;
  [k: string]: unknown;
}
/**
 * Edge TTS provider configuration (free, subprocess-based).
 */
export interface EdgeTtsConfig {
  /**
   * Path to the `edge-tts` binary (default `"edge-tts"`).
   */
  binary_path?: string;
  [k: string]: unknown;
}
/**
 * ElevenLabs TTS provider configuration.
 */
export interface ElevenLabsTtsConfig {
  /**
   * API key for ElevenLabs.
   */
  api_key?: string | null;
  /**
   * Model ID (default `"eleven_monolingual_v1"`).
   */
  model_id?: string;
  /**
   * Similarity boost (0.0-1.0, default `0.5`).
   */
  similarity_boost?: number;
  /**
   * Voice stability (0.0-1.0, default `0.5`).
   */
  stability?: number;
  [k: string]: unknown;
}
/**
 * Google Cloud TTS provider configuration.
 */
export interface GoogleTtsConfig {
  /**
   * API key for Google Cloud TTS.
   */
  api_key?: string | null;
  /**
   * Language code (default `"en-US"`).
   */
  language_code?: string;
  [k: string]: unknown;
}
/**
 * OpenAI TTS provider configuration.
 */
export interface OpenAiTtsConfig {
  /**
   * API key for OpenAI TTS.
   */
  api_key?: string | null;
  /**
   * Model name (default `"tts-1"`).
   */
  model?: string;
  /**
   * Playback speed multiplier (default `1.0`).
   */
  speed?: number;
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
 * Web fetch tool configuration (`[web_fetch]`).
 */
export interface WebFetchConfig {
  /**
   * Allowed domains for web fetch (exact or subdomain match; `["*"]` = all public hosts)
   */
  allowed_domains?: string[];
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
   * Request timeout in seconds (default: 30)
   */
  timeout_secs?: number;
  [k: string]: unknown;
}
/**
 * Web search tool configuration (`[web_search]`).
 */
export interface WebSearchConfig {
  /**
   * Brave Search API key (required if provider is "brave")
   */
  brave_api_key?: string | null;
  /**
   * Enable `web_search_tool` for web searches
   */
  enabled?: boolean;
  /**
   * Maximum results per search (1-10)
   */
  max_results?: number;
  /**
   * Search provider: "duckduckgo" (free, no API key) or "brave" (requires API key)
   */
  provider?: string;
  /**
   * Request timeout in seconds
   */
  timeout_secs?: number;
  [k: string]: unknown;
}
