import type { WakeHookAdapter, WakeSignal, AuthResult } from "../types.js";
import { verifyHmacSha256 } from "../hmac.js";
const SLACK_API = "https://slack.com/api";

/**
 * Max age (in seconds) for Slack request timestamps before we reject as replay.
 */
const MAX_TIMESTAMP_AGE = 300;

export class SlackWakeHookAdapter implements WakeHookAdapter {
  readonly channelId = "slack";
  readonly name = "Slack";
  readonly programmableWebhook = false;
  readonly wakeResponseStatus = 200;

  constructor(
    private readonly botToken: string,
    private readonly signingSecret: string,
  ) {}

  async registerWebhook(_webhookUrl: string): Promise<void> {
    // Slack webhooks are configured in the app dashboard — no-op.
  }

  async deleteWebhook(): Promise<void> {
    // Slack webhooks are configured in the app dashboard — no-op.
  }

  async verifyRequest(req: Request, body: Buffer): Promise<AuthResult> {
    if (!this.signingSecret) {
      return { valid: false, error: "Server misconfigured" };
    }

    const signature = req.headers.get("x-slack-signature");
    const timestamp = req.headers.get("x-slack-request-timestamp");

    if (!signature || !timestamp) {
      return { valid: false, error: "Missing Slack signature headers" };
    }

    // Replay protection: reject timestamps older than 5 minutes
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_TIMESTAMP_AGE) {
      return { valid: false, error: "Request timestamp too old" };
    }

    // Slack signature format: v0=<hex>
    const sigBase = `v0:${timestamp}:${body.toString("utf-8")}`;
    const expectedHex = signature.startsWith("v0=") ? signature.slice(3) : signature;

    if (!verifyHmacSha256(this.signingSecret, sigBase, expectedHex)) {
      return { valid: false, error: "Invalid Slack signature" };
    }

    return { valid: true };
  }

  handleChallenge(_req: Request, body: unknown): Response | null {
    const payload = body as Record<string, unknown> | null;
    if (payload?.type === "url_verification" && typeof payload.challenge === "string") {
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }

  parseWakeSignal(body: unknown): WakeSignal | null {
    const payload = body as Record<string, unknown> | null;
    if (!payload || payload.type !== "event_callback") return null;

    const event = payload.event as Record<string, unknown> | undefined;
    if (!event || event.type !== "message") return null;

    // Skip non-user messages (bot_message, message_changed, channel_join, etc.)
    // Regular user messages never have a subtype set.
    if (event.bot_id || event.subtype) return null;

    const chatId = event.channel as string | undefined;
    const messageText = event.text as string | undefined;

    return {
      channelId: this.channelId,
      chatId: chatId || undefined,
      messageText: messageText || undefined,
      rawPayload: body,
    };
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    try {
      await fetch(`${SLACK_API}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: chatId, text: message }),
      });
    } catch {
      // Best-effort — courtesy message failure is not critical
    }
  }
}
