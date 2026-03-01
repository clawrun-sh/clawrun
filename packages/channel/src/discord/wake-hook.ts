import type { WakeHookAdapter, WakeSignal, AuthResult } from "../types.js";
import { verifyEd25519 } from "../ed25519.js";
import { createLogger } from "@clawrun/logger";

const log = createLogger("channel:discord");

const DISCORD_API = "https://discord.com/api/v10";

/** Discord interaction types */
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;

export class DiscordWakeHookAdapter implements WakeHookAdapter {
  readonly channelId = "discord";
  readonly name = "Discord";
  readonly programmableWebhook = true;
  readonly wakeResponseStatus = 200;

  constructor(
    private readonly botToken: string,
    private readonly applicationId: string,
    private readonly publicKey: string,
  ) {}

  async registerWebhook(webhookUrl: string): Promise<void> {
    const headers = {
      Authorization: `Bot ${this.botToken}`,
      "Content-Type": "application/json",
    };

    // Set the Interactions Endpoint URL so Discord POSTs slash commands to us
    await fetch(`${DISCORD_API}/applications/@me`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ interactions_endpoint_url: webhookUrl }),
    });

    // Register /ask slash command (upsert — safe to call repeatedly)
    await fetch(`${DISCORD_API}/applications/${this.applicationId}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "ask",
        description: "Send a message to the agent",
        options: [
          {
            name: "message",
            description: "Your message",
            type: 3, // STRING
            required: true,
          },
        ],
      }),
    });

    log.info("Registered Discord interactions endpoint and /ask command");
  }

  async deleteWebhook(): Promise<void> {
    // Clear the Interactions Endpoint URL so slash commands go back to Gateway
    await fetch(`${DISCORD_API}/applications/@me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${this.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ interactions_endpoint_url: "" }),
    });

    log.info("Cleared Discord interactions endpoint");
  }

  async verifyRequest(req: Request, body: Buffer): Promise<AuthResult> {
    if (!this.publicKey) {
      return { valid: false, error: "Server misconfigured" };
    }

    const signature = req.headers.get("x-signature-ed25519");
    const timestamp = req.headers.get("x-signature-timestamp");

    if (!signature || !timestamp) {
      return { valid: false, error: "Missing Discord signature headers" };
    }

    const message = timestamp + body.toString("utf-8");

    if (!verifyEd25519(this.publicKey, signature, message)) {
      return { valid: false, error: "Invalid Discord signature" };
    }

    return { valid: true };
  }

  handleChallenge(_req: Request, body: unknown): Response | null {
    const payload = body as Record<string, unknown> | null;
    if (payload?.type === INTERACTION_PING) {
      return new Response(JSON.stringify({ type: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }

  parseWakeSignal(body: unknown): WakeSignal | null {
    const payload = body as Record<string, unknown> | null;
    if (!payload) return null;

    // Only handle application commands (slash commands)
    if (payload.type !== INTERACTION_APPLICATION_COMMAND) return null;

    const data = payload.data as Record<string, unknown> | undefined;
    const channelId = payload.channel_id as string | undefined;
    const interactionId = payload.id as string | undefined;
    const interactionToken = payload.token as string | undefined;

    // Extract message text from command options
    // Typical: /ask message:"Hello agent" → options[0].value = "Hello agent"
    let messageText: string | undefined;
    if (data) {
      const options = data.options as Array<Record<string, unknown>> | undefined;
      if (options && options.length > 0) {
        // Use the first string option as message text
        const textOption = options.find((o) => typeof o.value === "string");
        messageText = textOption?.value as string | undefined;
      }
      // Fallback: use the command name itself if no options
      if (!messageText) {
        messageText = data.name as string | undefined;
      }
    }

    // Immediately acknowledge the interaction with a visible message.
    // Type 4 (CHANNEL_MESSAGE_WITH_SOURCE) resolves the interaction right away —
    // no "thinking..." spinner, no follow-up needed.
    if (interactionId && interactionToken) {
      this.acknowledgeInteraction(interactionId, interactionToken).catch(() => {});
    }

    return {
      channelId: this.channelId,
      chatId: channelId || undefined,
      messageText: messageText || undefined,
      rawPayload: body,
      acknowledged: true,
    };
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    try {
      // Send via channel messages endpoint (works for follow-ups and general messages)
      await fetch(`${DISCORD_API}/channels/${chatId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: message }),
      });
    } catch {
      // Best-effort — courtesy message failure is not critical
    }
  }

  /**
   * Acknowledge the interaction with an immediate visible message (type 4).
   * This fully resolves the interaction — no "thinking..." spinner, no follow-up needed.
   * Must respond within 3 seconds of receiving the interaction.
   */
  private async acknowledgeInteraction(
    interactionId: string,
    interactionToken: string,
  ): Promise<void> {
    try {
      await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Type 4 = CHANNEL_MESSAGE_WITH_SOURCE
        body: JSON.stringify({
          type: 4,
          data: { content: "Waking up, one moment..." },
        }),
      });
    } catch {
      // Best-effort
    }
  }
}
