import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all validator imports to avoid real HTTP calls
vi.mock("./telegram/validator.js", () => ({
  validator: { channelId: "telegram", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./discord/validator.js", () => ({
  validator: { channelId: "discord", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./slack/validator.js", () => ({
  validator: { channelId: "slack", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./matrix/validator.js", () => ({
  validator: { channelId: "matrix", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./whatsapp/validator.js", () => ({
  validator: { channelId: "whatsapp", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./linq/validator.js", () => ({
  validator: { channelId: "linq", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./dingtalk/validator.js", () => ({
  validator: { channelId: "dingtalk", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./qq/validator.js", () => ({
  validator: { channelId: "qq", validate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("./lark/validator.js", () => ({
  validator: { channelId: "lark", validate: vi.fn(async () => ({ ok: true })) },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validators", () => {
  let validateChannel: typeof import("./validators.js").validateChannel;
  let hasValidator: typeof import("./validators.js").hasValidator;
  let getValidator: typeof import("./validators.js").getValidator;
  let getAllValidators: typeof import("./validators.js").getAllValidators;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./validators.js");
    validateChannel = mod.validateChannel;
    hasValidator = mod.hasValidator;
    getValidator = mod.getValidator;
    getAllValidators = mod.getAllValidators;
  });

  it("returns null for unknown channel (no validator)", async () => {
    const result = await validateChannel("unknown-channel", { key: "val" });
    expect(result).toBeNull();
  });

  it("delegates to channel validator on success", async () => {
    const result = await validateChannel("telegram", { bot_token: "123:ABC" });
    expect(result).toEqual({ ok: true });
  });

  it("wraps thrown errors into { ok: false }", async () => {
    const validator = getValidator("telegram");
    vi.mocked(validator!.validate).mockRejectedValueOnce(new Error("Network error"));

    const result = await validateChannel("telegram", { bot_token: "bad" });
    expect(result).toEqual({ ok: false, message: "Validation failed: Network error" });
  });

  it("wraps non-Error throws", async () => {
    const validator = getValidator("telegram");
    vi.mocked(validator!.validate).mockRejectedValueOnce("string error");

    const result = await validateChannel("telegram", { bot_token: "bad" });
    expect(result).toEqual({ ok: false, message: "Validation failed: Unknown error" });
  });

  it("hasValidator returns true for registered channels", () => {
    expect(hasValidator("telegram")).toBe(true);
    expect(hasValidator("discord")).toBe(true);
    expect(hasValidator("slack")).toBe(true);
    expect(hasValidator("matrix")).toBe(true);
    expect(hasValidator("whatsapp")).toBe(true);
    expect(hasValidator("linq")).toBe(true);
    expect(hasValidator("dingtalk")).toBe(true);
    expect(hasValidator("qq")).toBe(true);
    expect(hasValidator("lark")).toBe(true);
  });

  it("hasValidator returns false for unregistered channels", () => {
    expect(hasValidator("imessage")).toBe(false);
    expect(hasValidator("signal")).toBe(false);
    expect(hasValidator("nostr")).toBe(false);
  });

  it("getAllValidators returns all 9 registered validators", () => {
    const all = getAllValidators();
    expect(all).toHaveLength(9);
  });
});
