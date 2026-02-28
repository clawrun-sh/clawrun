/**
 * Result of validating channel credentials during onboarding.
 */
export interface ChannelValidationResult {
  ok: boolean;
  message: string;
}

/**
 * Validates channel credentials during onboarding.
 *
 * Each channel that supports credential verification implements this interface.
 * Validators make the same HTTP calls ZeroClaw's wizard.rs uses — they are
 * CLI-time only and have no runtime dependencies.
 */
export interface ChannelValidator {
  /** Unique channel identifier, e.g. "telegram", "discord". */
  readonly channelId: string;

  /** Verify credentials by calling the platform API. */
  validate(fields: Record<string, string>): Promise<ChannelValidationResult>;
}

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
  /** Text content of the triggering message, if available. */
  messageText?: string;
  /** Original webhook payload for debugging/logging. */
  rawPayload: unknown;
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

  /** Send a text message to a chat. Best-effort, never throws. */
  sendMessage(chatId: string, message: string): Promise<void>;
}
