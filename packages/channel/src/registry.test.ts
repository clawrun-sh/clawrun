import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all channel wake-hook adapters using class syntax (vitest v4 requires
// constructable implementations when the code under test calls `new`).
vi.mock("./telegram/wake-hook.js", () => ({
  TelegramWakeHookAdapter: class {
    channelId = "telegram";
    botToken: string;
    webhookSecret: string;
    programmableWebhook = true;
    constructor(token: string, secret: string) {
      this.botToken = token;
      this.webhookSecret = secret;
    }
  },
}));

vi.mock("./slack/wake-hook.js", () => ({
  SlackWakeHookAdapter: class {
    channelId = "slack";
    botToken: string;
    signingSecret: string;
    programmableWebhook = false;
    constructor(token: string, signingSecret: string) {
      this.botToken = token;
      this.signingSecret = signingSecret;
    }
  },
}));

vi.mock("./whatsapp/wake-hook.js", () => ({
  WhatsAppWakeHookAdapter: class {
    channelId = "whatsapp";
    programmableWebhook = true;
  },
}));

vi.mock("./discord/wake-hook.js", () => ({
  DiscordWakeHookAdapter: class {
    channelId = "discord";
    programmableWebhook = false;
  },
}));

vi.mock("./lark/wake-hook.js", () => ({
  LarkWakeHookAdapter: class {
    channelId = "lark";
    useFeishu: boolean;
    programmableWebhook = true;
    constructor(_a: string, _b: string, _c: string, feishu: boolean) {
      this.useFeishu = feishu;
    }
  },
}));

vi.mock("./qq/wake-hook.js", () => ({
  QQWakeHookAdapter: class {
    channelId = "qq";
    environment: string;
    programmableWebhook = true;
    constructor(_a: string, _b: string, env: string) {
      this.environment = env;
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("channel registry", () => {
  let initializeAdapters: typeof import("./registry.js").initializeAdapters;
  let getAdapter: typeof import("./registry.js").getAdapter;
  let getAllAdapters: typeof import("./registry.js").getAllAdapters;
  let hasWakeHook: typeof import("./registry.js").hasWakeHook;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./registry.js");
    initializeAdapters = mod.initializeAdapters;
    getAdapter = mod.getAdapter;
    getAllAdapters = mod.getAllAdapters;
    hasWakeHook = mod.hasWakeHook;
  });

  it("creates adapters for channels with credentials", () => {
    initializeAdapters({ telegram: { bot_token: "123:ABC" } }, { telegram: "tg-secret" });

    const adapter = getAdapter("telegram");
    expect(adapter).toBeDefined();
    expect((adapter as unknown as Record<string, unknown>).botToken).toBe("123:ABC");
    expect((adapter as unknown as Record<string, unknown>).webhookSecret).toBe("tg-secret");
  });

  it("falls back to empty string when no webhook secret", () => {
    initializeAdapters({ telegram: { bot_token: "123:ABC" } }, {});

    const adapter = getAdapter("telegram");
    expect(adapter).toBeDefined();
    expect((adapter as unknown as Record<string, unknown>).webhookSecret).toBe("");
  });

  it("skips channels without credentials", () => {
    initializeAdapters({}, { telegram: "secret" });

    expect(getAdapter("telegram")).toBeUndefined();
    expect(getAllAdapters()).toHaveLength(0);
  });

  it("creates multiple adapters from config", () => {
    initializeAdapters(
      {
        telegram: { bot_token: "tg-token" },
        slack: { bot_token: "xoxb-token", signing_secret: "slack-sig" },
      },
      { telegram: "tg-secret" },
    );

    expect(getAllAdapters()).toHaveLength(2);
    expect(getAdapter("telegram")).toBeDefined();
    expect(getAdapter("slack")).toBeDefined();
  });

  it("clears and rebuilds on re-init", () => {
    initializeAdapters({ telegram: { bot_token: "old" } }, {});
    expect(getAllAdapters()).toHaveLength(1);

    initializeAdapters({ slack: { bot_token: "xoxb-new", signing_secret: "sig" } }, {});
    expect(getAllAdapters()).toHaveLength(1);
    expect(getAdapter("telegram")).toBeUndefined();
    expect(getAdapter("slack")).toBeDefined();
  });

  it("returns undefined for unknown channel", () => {
    initializeAdapters({}, {});
    expect(getAdapter("unknown")).toBeUndefined();
  });

  it("hasWakeHook returns true for supported channels", () => {
    expect(hasWakeHook("telegram")).toBe(true);
    expect(hasWakeHook("slack")).toBe(true);
    expect(hasWakeHook("discord")).toBe(true);
    expect(hasWakeHook("whatsapp")).toBe(true);
    expect(hasWakeHook("lark")).toBe(true);
    expect(hasWakeHook("qq")).toBe(true);
  });

  it("hasWakeHook returns false for unsupported channels", () => {
    expect(hasWakeHook("imessage")).toBe(false);
    expect(hasWakeHook("signal")).toBe(false);
    expect(hasWakeHook("unknown")).toBe(false);
  });
});
