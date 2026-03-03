import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmacSha256 } from "./hmac.js";

// ---------------------------------------------------------------------------
// verifyHmacSha256
// ---------------------------------------------------------------------------
describe("verifyHmacSha256", () => {
  const secret = "test-secret";
  const payload = "v0:12345:some-body";
  const validHex = createHmac("sha256", secret).update(payload).digest("hex");

  it("valid HMAC returns true", () => {
    expect(verifyHmacSha256(secret, payload, validHex)).toBe(true);
  });

  it("invalid HMAC returns false", () => {
    expect(verifyHmacSha256(secret, payload, "0".repeat(validHex.length))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TelegramWakeHookAdapter
// ---------------------------------------------------------------------------
describe("TelegramWakeHookAdapter", () => {
  // Dynamic import so we don't need the module resolved at parse time
  async function createAdapter() {
    const { TelegramWakeHookAdapter } = await import("./telegram/wake-hook.js");
    return new TelegramWakeHookAdapter("bot-token", "webhook-secret-123");
  }

  describe("verifyRequest", () => {
    it("valid secret-token header returns valid", async () => {
      const adapter = await createAdapter();
      const req = new Request("http://localhost", {
        headers: { "x-telegram-bot-api-secret-token": "webhook-secret-123" },
      });
      const result = await adapter.verifyRequest(req, Buffer.from(""));
      expect(result.valid).toBe(true);
    });

    it("missing header returns invalid", async () => {
      const adapter = await createAdapter();
      const req = new Request("http://localhost");
      const result = await adapter.verifyRequest(req, Buffer.from(""));
      expect(result.valid).toBe(false);
    });
  });

  describe("parseWakeSignal", () => {
    it("message update returns WakeSignal with chatId and text", async () => {
      const adapter = await createAdapter();
      const body = {
        message: {
          chat: { id: 12345 },
          text: "Hello agent",
        },
      };
      const signal = adapter.parseWakeSignal(body);
      expect(signal?.chatId).toBe("12345");
      expect(signal?.messageText).toBe("Hello agent");
    });

    it("non-message update returns null", async () => {
      const adapter = await createAdapter();
      const body = { callback_query: {} };
      const signal = adapter.parseWakeSignal(body);
      expect(signal).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// SlackWakeHookAdapter
// ---------------------------------------------------------------------------
describe("SlackWakeHookAdapter", () => {
  const signingSecret = "slack-signing-secret";

  async function createAdapter() {
    const { SlackWakeHookAdapter } = await import("./slack/wake-hook.js");
    return new SlackWakeHookAdapter("xoxb-token", signingSecret);
  }

  describe("verifyRequest", () => {
    it("valid signature with fresh timestamp returns valid", async () => {
      const adapter = await createAdapter();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const bodyStr = '{"type":"event_callback"}';
      const sigBase = `v0:${timestamp}:${bodyStr}`;
      const hmac = createHmac("sha256", signingSecret).update(sigBase).digest("hex");

      const req = new Request("http://localhost", {
        headers: {
          "x-slack-signature": `v0=${hmac}`,
          "x-slack-request-timestamp": timestamp,
        },
      });
      const result = await adapter.verifyRequest(req, Buffer.from(bodyStr));
      expect(result.valid).toBe(true);
    });

    it("stale timestamp (>300s) returns invalid", async () => {
      const adapter = await createAdapter();
      const timestamp = String(Math.floor(Date.now() / 1000) - 400);
      const bodyStr = "body";
      const sigBase = `v0:${timestamp}:${bodyStr}`;
      const hmac = createHmac("sha256", signingSecret).update(sigBase).digest("hex");

      const req = new Request("http://localhost", {
        headers: {
          "x-slack-signature": `v0=${hmac}`,
          "x-slack-request-timestamp": timestamp,
        },
      });
      const result = await adapter.verifyRequest(req, Buffer.from(bodyStr));
      expect(result.valid).toBe(false);
    });
  });

  describe("parseWakeSignal", () => {
    it("user message returns WakeSignal", async () => {
      const adapter = await createAdapter();
      const body = {
        type: "event_callback",
        event: { type: "message", channel: "C123", text: "hello" },
      };
      const signal = adapter.parseWakeSignal(body);
      expect(signal).not.toBeNull();
      expect(signal!.messageText).toBe("hello");
    });

    it("bot message returns null", async () => {
      const adapter = await createAdapter();
      const body = {
        type: "event_callback",
        event: { type: "message", channel: "C123", text: "hi", bot_id: "B123" },
      };
      const signal = adapter.parseWakeSignal(body);
      expect(signal).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// DiscordWakeHookAdapter — handleChallenge
// ---------------------------------------------------------------------------
describe("DiscordWakeHookAdapter", () => {
  async function createAdapter() {
    const { DiscordWakeHookAdapter } = await import("./discord/wake-hook.js");
    return new DiscordWakeHookAdapter("bot-token", "app-id", "pubkey-hex");
  }

  describe("handleChallenge", () => {
    it("PING (type=1) returns ACK response", async () => {
      const adapter = await createAdapter();
      const req = new Request("http://localhost");
      const resp = adapter.handleChallenge(req, { type: 1 });
      expect(resp).not.toBeNull();
      const json = await resp!.json();
      expect(json.type).toBe(1);
    });

    it("non-PING returns null", async () => {
      const adapter = await createAdapter();
      const req = new Request("http://localhost");
      const result = adapter.handleChallenge(req, { type: 2 });
      expect(result).toBeNull();
    });
  });
});
