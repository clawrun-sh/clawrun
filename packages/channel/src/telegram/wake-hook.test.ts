import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramWakeHookAdapter } from "./wake-hook.js";

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

let adapter: TelegramWakeHookAdapter;

beforeEach(() => {
  adapter = new TelegramWakeHookAdapter("123:ABC", "test-webhook-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyRequest", () => {
  it("returns valid when secret token matches", async () => {
    const req = new Request("http://localhost", {
      headers: { "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    });
    const result = await adapter.verifyRequest(req, Buffer.from(""));
    expect(result.valid).toBe(true);
  });

  it("returns invalid when header is missing", async () => {
    const req = new Request("http://localhost");
    const result = await adapter.verifyRequest(req, Buffer.from(""));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing");
  });

  it("returns invalid when secret does not match", async () => {
    const req = new Request("http://localhost", {
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
    });
    const result = await adapter.verifyRequest(req, Buffer.from(""));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });
});

describe("parseWakeSignal", () => {
  it("extracts chat ID and text from update", () => {
    const signal = adapter.parseWakeSignal({
      message: { chat: { id: 12345 }, text: "Hello agent" },
    });

    expect(signal).not.toBeNull();
    expect(signal!.channelId).toBe("telegram");
    expect(signal!.chatId).toBe("12345");
    expect(signal!.messageText).toBe("Hello agent");
  });

  it("returns null for empty payload", () => {
    expect(adapter.parseWakeSignal(null)).toBeNull();
  });

  it("returns null when message is missing", () => {
    expect(adapter.parseWakeSignal({ update_id: 1 })).toBeNull();
  });

  it("handles message without text", () => {
    const signal = adapter.parseWakeSignal({
      message: { chat: { id: 99 } },
    });
    expect(signal).not.toBeNull();
    expect(signal!.messageText).toBeUndefined();
  });
});

describe("registerWebhook", () => {
  it("calls Telegram setWebhook API", async () => {
    await adapter.registerWebhook("https://my-bot.com/api/v1/webhook/telegram");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/setWebhook"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("my-bot.com"),
      }),
    );
  });
});

describe("sendMessage", () => {
  it("calls sendMessage API", async () => {
    await adapter.sendMessage("12345", "Wake up!");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({
        body: expect.stringContaining("12345"),
      }),
    );
  });

  it("does not throw on fetch failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network"));
    await expect(adapter.sendMessage("1", "hi")).resolves.toBeUndefined();
  });
});
