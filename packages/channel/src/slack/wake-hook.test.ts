import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { SlackWakeHookAdapter } from "./wake-hook.js";

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const SIGNING_SECRET = "test-signing-secret";
let adapter: SlackWakeHookAdapter;

beforeEach(() => {
  adapter = new SlackWakeHookAdapter("xoxb-token", SIGNING_SECRET);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSignedRequest(
  body: string,
  timestampOverride?: number,
): { req: Request; bodyBuf: Buffer } {
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const sigBase = `v0:${timestamp}:${body}`;
  const hex = createHmac("sha256", SIGNING_SECRET).update(sigBase).digest("hex");
  const req = new Request("http://localhost", {
    method: "POST",
    headers: {
      "x-slack-signature": `v0=${hex}`,
      "x-slack-request-timestamp": String(timestamp),
    },
  });
  return { req, bodyBuf: Buffer.from(body) };
}

describe("verifyRequest", () => {
  it("returns valid for correctly signed request", async () => {
    const { req, bodyBuf } = makeSignedRequest('{"type":"event_callback"}');
    const result = await adapter.verifyRequest(req, bodyBuf);
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
        "x-slack-signature": "v0=deadbeef",
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });
    const result = await adapter.verifyRequest(req, Buffer.from("body"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("rejects timestamps older than 5 minutes (replay protection)", async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400;
    const { req, bodyBuf } = makeSignedRequest("body", oldTimestamp);
    const result = await adapter.verifyRequest(req, bodyBuf);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too old");
  });

  it("returns invalid when signing secret is empty", async () => {
    const emptyAdapter = new SlackWakeHookAdapter("xoxb-token", "");
    const req = new Request("http://localhost", {
      headers: {
        "x-slack-signature": "v0=abc",
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });
    const result = await emptyAdapter.verifyRequest(req, Buffer.from(""));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("misconfigured");
  });
});

describe("handleChallenge", () => {
  it("responds to url_verification with challenge", () => {
    const body = { type: "url_verification", challenge: "test-challenge-123" };
    const resp = adapter.handleChallenge(new Request("http://localhost"), body);

    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(200);
  });

  it("returns null for non-challenge payloads", () => {
    const resp = adapter.handleChallenge(new Request("http://localhost"), {
      type: "event_callback",
    });
    expect(resp).toBeNull();
  });
});

describe("parseWakeSignal", () => {
  it("extracts channel and text from event_callback", () => {
    const signal = adapter.parseWakeSignal({
      type: "event_callback",
      event: { type: "message", channel: "C12345", text: "Hello" },
    });

    expect(signal).not.toBeNull();
    expect(signal!.channelId).toBe("slack");
    expect(signal!.chatId).toBe("C12345");
    expect(signal!.messageText).toBe("Hello");
  });

  it("returns null for non-event_callback", () => {
    expect(adapter.parseWakeSignal({ type: "url_verification" })).toBeNull();
  });

  it("skips bot messages", () => {
    const signal = adapter.parseWakeSignal({
      type: "event_callback",
      event: { type: "message", bot_id: "B123", channel: "C1", text: "bot msg" },
    });
    expect(signal).toBeNull();
  });

  it("skips subtypes (message_changed, etc.)", () => {
    const signal = adapter.parseWakeSignal({
      type: "event_callback",
      event: { type: "message", subtype: "message_changed", channel: "C1" },
    });
    expect(signal).toBeNull();
  });
});

describe("sendMessage", () => {
  it("calls chat.postMessage API", async () => {
    await adapter.sendMessage("C12345", "Hello!");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("chat.postMessage"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer xoxb-token" }),
      }),
    );
  });

  it("does not throw on fetch failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network"));
    await expect(adapter.sendMessage("C1", "hi")).resolves.toBeUndefined();
  });
});
