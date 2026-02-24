import { timingSafeEqual } from "node:crypto";
import type { WakeHookAdapter, WakeSignal, AuthResult, ChannelEnvMapping } from "../types.js";
import { createLogger } from "@cloudclaw/logger";

const log = createLogger("channel:telegram");

const TELEGRAM_API = "https://api.telegram.org/bot";

export class TelegramWakeHookAdapter implements WakeHookAdapter {
  readonly channelId = "telegram";
  readonly name = "Telegram";
  readonly programmableWebhook = true;
  readonly wakeResponseStatus = 503;

  readonly envMapping: ChannelEnvMapping = {
    channelId: "telegram",
    configKey: "telegram",
    fields: [{ configField: "bot_token", envVar: "CLOUDCLAW_TELEGRAM_BOT_TOKEN" }],
    generatedSecrets: [
      { envVar: "CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET", purpose: "webhook request verification" },
    ],
  };

  private get token(): string | undefined {
    return process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN;
  }

  private get webhookSecret(): string | undefined {
    return process.env.CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET;
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
    const token = this.token;
    if (!token) return;

    const secret = this.webhookSecret;
    if (!secret) {
      log.warn("CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET not set — skipping webhook registration");
      return;
    }

    await fetch(`${TELEGRAM_API}${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ["message"],
      }),
    });
  }

  async deleteWebhook(): Promise<void> {
    const token = this.token;
    if (!token) return;

    await fetch(`${TELEGRAM_API}${token}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
  }

  async verifyRequest(req: Request, _body: Buffer): Promise<AuthResult> {
    const secret = this.webhookSecret;
    if (!secret) {
      log.error("CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET is not configured — rejecting request");
      return { valid: false, error: "Server misconfigured" };
    }

    const header = req.headers.get("x-telegram-bot-api-secret-token");
    if (!header) {
      return { valid: false, error: "Missing secret token header" };
    }

    if (!safeEqual(header, secret)) {
      return { valid: false, error: "Invalid secret token" };
    }

    return { valid: true };
  }

  parseWakeSignal(body: unknown): WakeSignal | null {
    const update = body as Record<string, unknown> | null;
    if (!update) return null;

    const message = update.message as Record<string, unknown> | undefined;
    if (!message) return null;

    const chat = message.chat as Record<string, unknown> | undefined;
    const chatId = chat?.id as number | undefined;

    return {
      channelId: this.channelId,
      chatId: chatId != null ? String(chatId) : undefined,
      rawPayload: body,
    };
  }

  async sendCourtesyMessage(chatId: string, message: string): Promise<void> {
    const token = this.token;
    if (!token) return;

    try {
      await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      });
    } catch {
      // Best-effort — courtesy message failure is not critical
    }
  }
}

/** Timing-safe string comparison. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
