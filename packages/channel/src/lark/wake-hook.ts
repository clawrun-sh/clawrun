import type { WakeHookAdapter, WakeSignal, AuthResult } from "../types.js";
import { safeEqual } from "../safe-equal.js";
import { createLogger } from "@clawrun/logger";

const log = createLogger("channel:lark");

const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const LARK_BASE = "https://open.larksuite.com/open-apis";

export class LarkWakeHookAdapter implements WakeHookAdapter {
  readonly channelId = "lark";
  readonly name = "Lark / Feishu";
  readonly programmableWebhook = false;
  readonly wakeResponseStatus = 200;

  private readonly baseUrl: string;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly verificationToken: string,
    useFeishu: boolean,
  ) {
    this.baseUrl = useFeishu ? FEISHU_BASE : LARK_BASE;
  }

  async registerWebhook(_webhookUrl: string): Promise<void> {
    // Lark/Feishu Request URL is configured in Developer Console — no-op.
  }

  async deleteWebhook(): Promise<void> {
    // Lark/Feishu Request URL is configured in Developer Console — no-op.
  }

  async verifyRequest(_req: Request, body: Buffer): Promise<AuthResult> {
    if (!this.verificationToken) {
      return { valid: false, error: "Server misconfigured" };
    }

    // Lark uses a verification token in the JSON body header
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      return { valid: false, error: "Invalid JSON body" };
    }

    // Token location depends on event version:
    // v1: body.token
    // v2: body.header.token
    const header = parsed.header as Record<string, unknown> | undefined;
    const token = (header?.token ?? parsed.token) as string | undefined;

    if (!token || !safeEqual(token, this.verificationToken)) {
      return { valid: false, error: "Invalid Lark verification token" };
    }

    return { valid: true };
  }

  handleChallenge(_req: Request, body: unknown): Response | null {
    const payload = body as Record<string, unknown> | null;

    // v2 challenge: { type: "url_verification", challenge: "..." }
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
    if (!payload) return null;

    // v2 event format
    const header = payload.header as Record<string, unknown> | undefined;
    const eventType = header?.event_type as string | undefined;

    if (eventType !== "im.message.receive_v1") return null;

    const event = payload.event as Record<string, unknown> | undefined;
    if (!event) return null;

    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return null;

    // Skip non-text messages
    if (message.message_type !== "text") return null;

    const chatId = message.chat_id as string | undefined;
    let messageText: string | undefined;

    // message.content is a JSON string: '{"text":"Hello"}'
    const content = message.content as string | undefined;
    if (content) {
      try {
        const parsed = JSON.parse(content);
        messageText = parsed.text as string | undefined;
      } catch {
        // Fall through — no message text
      }
    }

    return {
      channelId: this.channelId,
      chatId: chatId || undefined,
      messageText: messageText || undefined,
      rawPayload: body,
    };
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    try {
      const tenantToken = await this.getTenantAccessToken();
      if (!tenantToken) return;

      await fetch(`${this.baseUrl}/im/v1/messages?receive_id_type=chat_id`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: message }),
        }),
      });
    } catch {
      // Best-effort — courtesy message failure is not critical
    }
  }

  private async getTenantAccessToken(): Promise<string | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      return (data.tenant_access_token as string) || null;
    } catch {
      log.error("Failed to get Lark tenant access token");
      return null;
    }
  }
}
