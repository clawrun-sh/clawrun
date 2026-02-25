/**
 * Result of verifying an incoming webhook request.
 */
export interface AuthResult {
  valid: boolean;
  error?: string;
}

/**
 * Signal extracted from a webhook payload indicating a message arrived.
 */
export interface WakeSignal {
  channelId: string;
  /** Chat/channel/conversation ID for sending courtesy messages. */
  chatId?: string;
  /** Original webhook payload for debugging/logging. */
  rawPayload: unknown;
}

/**
 * Maps an agent's channel configuration to ClawRun env vars.
 *
 * Used by the CLI to extract tokens from the agent's config.toml (via napi)
 * and surface them as CLAWRUN_* env vars for the deployed app.
 */
export interface ChannelEnvMapping {
  channelId: string;
  /** Key in agent's channels_config, e.g. "telegram" */
  configKey: string;
  /** Fields to extract: configField -> envVar name */
  fields: Array<{
    configField: string; // e.g. "bot_token"
    envVar: string; // e.g. "CLAWRUN_TELEGRAM_BOT_TOKEN"
  }>;
  /** Auto-generated secrets (not from agent config) */
  generatedSecrets: Array<{
    envVar: string; // e.g. "CLAWRUN_TELEGRAM_WEBHOOK_SECRET"
    purpose: string; // human-readable, e.g. "webhook request verification"
  }>;
}

/**
 * Adapter for waking the sandbox via a channel's webhook.
 *
 * Each messaging channel that supports HTTP push implements this interface.
 * Adapters handle verification, webhook lifecycle, and courtesy messages
 * using only `fetch()` and `node:crypto` — zero runtime dependencies.
 */
export interface WakeHookAdapter {
  /** Unique channel identifier, e.g. "telegram", "slack", "discord". */
  readonly channelId: string;
  /** Human-readable name, e.g. "Telegram". */
  readonly name: string;

  /**
   * true = adapter can call registerWebhook()/deleteWebhook() programmatically.
   * false = webhook is always-on (configured in platform dashboard),
   * handler must check sandbox state before waking.
   */
  readonly programmableWebhook: boolean;

  /**
   * HTTP status to return after triggering wake.
   * 503 = platform queues the message (Telegram).
   * 200 = platform considers it delivered (most others).
   */
  readonly wakeResponseStatus: number;

  /** Env vars this adapter needs. Used by CLI to extract from agent config. */
  readonly envMapping: ChannelEnvMapping;

  /** Are required env vars set? */
  isConfigured(): boolean;

  /** Register webhook URL with the platform. No-op for always-on channels. */
  registerWebhook(webhookUrl: string): Promise<void>;

  /** Deregister webhook from the platform. No-op for always-on channels. */
  deleteWebhook(): Promise<void>;

  /** Verify incoming request (HMAC, Ed25519, token header, etc). */
  verifyRequest(req: Request, body: Buffer): Promise<AuthResult>;

  /**
   * Handle platform challenges (url_verification, PING).
   * Returns a Response if this is a challenge request, null otherwise.
   * Challenges must ALWAYS respond, regardless of sandbox state.
   */
  handleChallenge?(req: Request, body: unknown): Response | null;

  /** Extract wake signal from webhook payload. Null = not a wakeable event. */
  parseWakeSignal(body: unknown): WakeSignal | null;

  /** Send "waking up" courtesy message to user. Best-effort, never throws. */
  sendCourtesyMessage(chatId: string, message: string): Promise<void>;
}
