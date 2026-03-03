import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { DiscordWakeHookAdapter } from "./wake-hook.js";

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

// Generate real Ed25519 keypair for signature testing
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");

function signMessage(message: string): string {
  return sign(null, Buffer.from(message), privateKey).toString("hex");
}

let adapter: DiscordWakeHookAdapter;

beforeEach(() => {
  adapter = new DiscordWakeHookAdapter("bot-token", "app-id-123", publicKeyHex);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyRequest", () => {
  it("returns valid for correctly signed request", async () => {
    const timestamp = "1234567890";
    const body = '{"type":2}';
    const sig = signMessage(timestamp + body);
    const req = new Request("http://localhost", {
      headers: {
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
    });
    const result = await adapter.verifyRequest(req, Buffer.from(body));
    expect(result.valid).toBe(true);
  });

  it("returns invalid when headers are missing", async () => {
    const req = new Request("http://localhost");
    const result = await adapter.verifyRequest(req, Buffer.from(""));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing");
  });

  it("returns invalid for wrong signature", async () => {
    const req = new Request("http://localhost", {
      headers: {
        "x-signature-ed25519": "deadbeef".repeat(8),
        "x-signature-timestamp": "123",
      },
    });
    const result = await adapter.verifyRequest(req, Buffer.from("body"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("returns invalid when public key is empty", async () => {
    const noKeyAdapter = new DiscordWakeHookAdapter("bot-token", "app-id", "");
    const req = new Request("http://localhost", {
      headers: {
        "x-signature-ed25519": "abc",
        "x-signature-timestamp": "123",
      },
    });
    const result = await noKeyAdapter.verifyRequest(req, Buffer.from(""));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("misconfigured");
  });
});

describe("handleChallenge", () => {
  it("responds to INTERACTION_PING (type 1)", () => {
    const resp = adapter.handleChallenge(new Request("http://localhost"), { type: 1 });

    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(200);
  });

  it("returns null for non-ping interactions", () => {
    const resp = adapter.handleChallenge(new Request("http://localhost"), { type: 2 });
    expect(resp).toBeNull();
  });
});

describe("parseWakeSignal", () => {
  it("extracts message from slash command", () => {
    const signal = adapter.parseWakeSignal({
      type: 2,
      channel_id: "C999",
      id: "int-1",
      token: "tok-1",
      data: {
        name: "ask",
        options: [{ name: "message", value: "Hello agent", type: 3 }],
      },
    });

    expect(signal).not.toBeNull();
    expect(signal!.channelId).toBe("discord");
    expect(signal!.chatId).toBe("C999");
    expect(signal!.messageText).toBe("Hello agent");
    expect(signal!.acknowledged).toBe(true);
  });

  it("falls back to command name when no options", () => {
    const signal = adapter.parseWakeSignal({
      type: 2,
      channel_id: "C1",
      id: "int-1",
      token: "tok-1",
      data: { name: "ask", options: [] },
    });

    expect(signal!.messageText).toBe("ask");
  });

  it("returns null for non-application-command types", () => {
    expect(adapter.parseWakeSignal({ type: 1 })).toBeNull();
  });

  it("returns null for null payload", () => {
    expect(adapter.parseWakeSignal(null)).toBeNull();
  });
});

describe("registerWebhook", () => {
  it("sets interactions endpoint and registers slash command", async () => {
    await adapter.registerWebhook("https://my-bot.com/api/v1/webhook/discord");

    // Two fetch calls: PATCH @me + POST commands
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/applications/@me"),
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/commands"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("sendMessage", () => {
  it("posts to channel messages endpoint", async () => {
    await adapter.sendMessage("C999", "Agent response");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/channels/C999/messages"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bot bot-token" }),
      }),
    );
  });

  it("does not throw on fetch failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network"));
    await expect(adapter.sendMessage("C1", "hi")).resolves.toBeUndefined();
  });
});
