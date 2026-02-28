import { timingSafeEqual } from "node:crypto";
import type { WakeHookAdapter, WakeSignal, AuthResult } from "../types.js";
import { createLogger } from "@clawrun/logger";

const log = createLogger("channel:telegram");

const TELEGRAM_API = "https://api.telegram.org/bot";

export class TelegramWakeHookAdapter implements WakeHookAdapter {
  readonly channelId = "telegram";
  readonly name = "Telegram";
  readonly programmableWebhook = true;
  readonly wakeResponseStatus = 503;

  constructor(
    private readonly token: string,
    private readonly webhookSecret: string,
  ) {}

  async registerWebhook(webhookUrl: string): Promise<void> {
    await fetch(`${TELEGRAM_API}${this.token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: this.webhookSecret,
        allowed_updates: ["message"],
      }),
    });
  }

  async deleteWebhook(): Promise<void> {
    await fetch(`${TELEGRAM_API}${this.token}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
  }

  async verifyRequest(req: Request, _body: Buffer): Promise<AuthResult> {
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    if (!header) {
      return { valid: false, error: "Missing secret token header" };
    }

    if (!safeEqual(header, this.webhookSecret)) {
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
    try {
      await fetch(`${TELEGRAM_API}${this.token}/sendMessage`, {
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
