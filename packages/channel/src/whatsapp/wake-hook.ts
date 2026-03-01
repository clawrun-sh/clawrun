import type { WakeHookAdapter, WakeSignal, AuthResult } from "../types.js";
import { verifyHmacSha256 } from "../hmac.js";
import { safeEqual } from "../safe-equal.js";
import { createLogger } from "@clawrun/logger";

const log = createLogger("channel:whatsapp");

const GRAPH_API = "https://graph.facebook.com/v22.0";

export class WhatsAppWakeHookAdapter implements WakeHookAdapter {
  readonly channelId = "whatsapp";
  readonly name = "WhatsApp";
  readonly programmableWebhook = false;
  readonly wakeResponseStatus = 200;

  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly appSecret: string,
    private readonly verifyToken: string,
  ) {}

  async registerWebhook(_webhookUrl: string): Promise<void> {
    // WhatsApp webhooks are configured in Meta dashboard — no-op.
  }

  async deleteWebhook(): Promise<void> {
    // WhatsApp webhooks are configured in Meta dashboard — no-op.
  }

  async verifyRequest(req: Request, body: Buffer): Promise<AuthResult> {
    if (!this.appSecret) {
      return { valid: false, error: "Server misconfigured" };
    }

    const signature = req.headers.get("x-hub-signature-256");
    if (!signature) {
      return { valid: false, error: "Missing X-Hub-Signature-256 header" };
    }

    // Format: sha256=<hex>
    const expectedHex = signature.startsWith("sha256=") ? signature.slice(7) : signature;

    if (!verifyHmacSha256(this.appSecret, body.toString("utf-8"), expectedHex)) {
      return { valid: false, error: "Invalid WhatsApp signature" };
    }

    return { valid: true };
  }

  /**
   * Handle WhatsApp webhook URL verification (GET request).
   *
   * Meta sends a GET with hub.mode=subscribe, hub.verify_token, and hub.challenge.
   * We must echo back the challenge value as plain text.
   */
  handleVerifyGet(req: Request): Response | null {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token && challenge) {
      if (!this.verifyToken || !safeEqual(token, this.verifyToken)) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return null;
  }

  parseWakeSignal(body: unknown): WakeSignal | null {
    const payload = body as Record<string, unknown> | null;
    if (!payload) return null;

    const entries = payload.entry as Array<Record<string, unknown>> | undefined;
    if (!entries || entries.length === 0) return null;

    const changes = entries[0].changes as Array<Record<string, unknown>> | undefined;
    if (!changes || changes.length === 0) return null;

    const value = changes[0].value as Record<string, unknown> | undefined;
    if (!value) return null;

    // Skip status updates (delivery receipts, read receipts)
    if (value.statuses) return null;

    const messages = value.messages as Array<Record<string, unknown>> | undefined;
    if (!messages || messages.length === 0) return null;

    const message = messages[0];
    const chatId = message.from as string | undefined;
    const textObj = message.text as Record<string, unknown> | undefined;
    const messageText = textObj?.body as string | undefined;

    return {
      channelId: this.channelId,
      chatId: chatId || undefined,
      messageText: messageText || undefined,
      rawPayload: body,
    };
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    try {
      await fetch(`${GRAPH_API}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: chatId,
          type: "text",
          text: { body: message },
        }),
      });
    } catch {
      // Best-effort — courtesy message failure is not critical
    }
  }
}
