import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { WakeHookAdapter, WakeSignal, AuthResult } from "../types.js";
import { verifyEd25519 } from "../ed25519.js";
import { createLogger } from "@clawrun/logger";

const log = createLogger("channel:qq");

const QQ_TOKEN_API = "https://bots.qq.com/app/getAppAccessToken";
const QQ_API = "https://api.sgroup.qq.com";
const QQ_SANDBOX_API = "https://sandbox.api.sgroup.qq.com";

export class QQWakeHookAdapter implements WakeHookAdapter {
  readonly channelId = "qq";
  readonly name = "QQ";
  readonly programmableWebhook = false;
  readonly wakeResponseStatus = 200;

  private readonly apiBase: string;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    environment: string,
  ) {
    this.apiBase = environment === "sandbox" ? QQ_SANDBOX_API : QQ_API;
  }

  async registerWebhook(_webhookUrl: string): Promise<void> {
    // QQ webhooks are configured in Developer Console — no-op.
  }

  async deleteWebhook(): Promise<void> {
    // QQ webhooks are configured in Developer Console — no-op.
  }

  async verifyRequest(req: Request, body: Buffer): Promise<AuthResult> {
    if (!this.appSecret) {
      return { valid: false, error: "Server misconfigured" };
    }

    const signature = req.headers.get("x-signature-ed25519");
    const timestamp = req.headers.get("x-signature-timestamp");

    if (!signature || !timestamp) {
      return { valid: false, error: "Missing QQ signature headers" };
    }

    // QQ derives the Ed25519 seed from the app secret.
    // The public key is provided by QQ during app setup — for verification
    // we use the same Ed25519 approach as Discord.
    // QQ provides the seed; we derive the public key from it.
    const publicKey = this.derivePublicKey();
    if (!publicKey) {
      return { valid: false, error: "Failed to derive QQ public key" };
    }

    const message = timestamp + body.toString("utf-8");

    if (!verifyEd25519(publicKey, signature, message)) {
      return { valid: false, error: "Invalid QQ signature" };
    }

    return { valid: true };
  }

  handleChallenge(_req: Request, body: unknown): Response | null {
    const payload = body as Record<string, unknown> | null;
    if (!payload) return null;

    const d = payload.d as Record<string, unknown> | undefined;

    // QQ validation event: op=13 with a plain_token + event_ts in d
    if (payload.op === 13 && d?.plain_token && d?.event_ts) {
      // QQ expects us to echo back the plain_token and a signature
      // computed from the event_ts + plain_token using the bot secret
      return new Response(
        JSON.stringify({
          plain_token: d.plain_token,
          signature: this.computeChallengeSignature(d.event_ts as string, d.plain_token as string),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return null;
  }

  parseWakeSignal(body: unknown): WakeSignal | null {
    const payload = body as Record<string, unknown> | null;
    if (!payload) return null;

    const eventType = payload.t as string | undefined;
    const d = payload.d as Record<string, unknown> | undefined;
    if (!d) return null;

    let chatId: string | undefined;
    let messageText: string | undefined;

    // Prefix chatId with message context so sendMessage routes to the correct endpoint.
    // Format: "channel:{id}", "c2c:{openid}", "group:{openid}"
    if (
      eventType === "MESSAGE_CREATE" ||
      eventType === "AT_MESSAGE_CREATE" ||
      eventType === "DIRECT_MESSAGE_CREATE"
    ) {
      // Guild channel message or channel DM
      const rawId = d.channel_id as string | undefined;
      chatId = rawId ? `channel:${rawId}` : undefined;
      messageText = d.content as string | undefined;
    } else if (eventType === "C2C_MESSAGE_CREATE") {
      // Direct message — uses OpenID fields
      const author = d.author as Record<string, unknown> | undefined;
      const rawId = author?.user_openid as string | undefined;
      chatId = rawId ? `c2c:${rawId}` : undefined;
      messageText = d.content as string | undefined;
    } else if (eventType === "GROUP_AT_MESSAGE_CREATE") {
      // Group message — uses OpenID fields
      const rawId = d.group_openid as string | undefined;
      chatId = rawId ? `group:${rawId}` : undefined;
      messageText = d.content as string | undefined;
    } else {
      return null;
    }

    // Strip bot mention from message text (e.g., "<@!botid> Hello" or "<@botid> Hello" → "Hello")
    if (messageText) {
      messageText = messageText.replace(/<@!?\d+>\s*/g, "").trim() || undefined;
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
      const token = await this.getAccessToken();
      if (!token) return;

      // chatId is prefixed with context: "channel:{id}", "c2c:{openid}", "group:{openid}"
      const [kind, rawId] = chatId.includes(":") ? chatId.split(":", 2) : ["channel", chatId];

      let url: string;
      let body: Record<string, unknown>;

      if (kind === "c2c") {
        url = `${this.apiBase}/v2/users/${rawId}/messages`;
        body = { content: message, msg_type: 0 };
      } else if (kind === "group") {
        url = `${this.apiBase}/v2/groups/${rawId}/messages`;
        body = { content: message, msg_type: 0 };
      } else {
        // Default: guild channel
        url = `${this.apiBase}/channels/${rawId}/messages`;
        body = { content: message };
      }

      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `QQBot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Best-effort — courtesy message failure is not critical
    }
  }

  private async getAccessToken(): Promise<string | null> {
    try {
      const resp = await fetch(QQ_TOKEN_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      return (data.access_token as string) || null;
    } catch {
      log.error("Failed to get QQ access token");
      return null;
    }
  }

  /**
   * Derive Ed25519 public key from the app secret seed.
   * QQ uses the first 32 bytes of the bot secret as the Ed25519 seed.
   */
  private derivePublicKey(): string | null {
    try {
      const seed = this.buildSeed();
      const ED25519_SEED_DER_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
      const derKey = Buffer.concat([ED25519_SEED_DER_PREFIX, seed]);

      const privateKey = createPrivateKey({ key: derKey, format: "der", type: "pkcs8" });
      const publicKey = createPublicKey(privateKey);
      const exported = publicKey.export({ type: "spki", format: "der" });
      // Extract raw 32-byte key from DER (last 32 bytes)
      return Buffer.from(exported).subarray(-32).toString("hex");
    } catch {
      log.error("Failed to derive QQ Ed25519 public key");
      return null;
    }
  }

  /**
   * Compute challenge signature for QQ validation events.
   * Signs event_ts + plain_token with the Ed25519 key derived from app secret.
   */
  private computeChallengeSignature(eventTs: string, plainToken: string): string {
    try {
      const seed = this.buildSeed();
      const ED25519_SEED_DER_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
      const derKey = Buffer.concat([ED25519_SEED_DER_PREFIX, seed]);

      const privateKey = createPrivateKey({ key: derKey, format: "der", type: "pkcs8" });
      const message = Buffer.from(eventTs + plainToken);
      const sig = sign(null, message, privateKey);
      return sig.toString("hex");
    } catch {
      log.error("Failed to compute QQ challenge signature");
      return "";
    }
  }

  /**
   * Build 32-byte Ed25519 seed from app secret.
   * QQ repeats the secret string until it reaches >= 32 bytes, then truncates to 32.
   */
  private buildSeed(): Buffer {
    let repeated = this.appSecret;
    while (Buffer.byteLength(repeated, "utf-8") < 32) {
      repeated = repeated + repeated;
    }
    return Buffer.from(repeated, "utf-8").subarray(0, 32);
  }
}
