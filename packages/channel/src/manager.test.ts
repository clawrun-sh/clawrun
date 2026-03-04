import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WakeHookAdapter } from "./types.js";

vi.mock("./registry.js", () => ({
  getAllAdapters: vi.fn(() => []),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { getAllAdapters } from "./registry.js";
import { registerWakeHooks, teardownWakeHooks } from "./manager.js";

function mockAdapter(overrides: Record<string, unknown> = {}) {
  return {
    channelId: "telegram",
    name: "Telegram",
    programmableWebhook: true,
    registerWebhook: vi.fn(async () => {}),
    deleteWebhook: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerWakeHooks", () => {
  it("no-ops when no adapters configured", async () => {
    vi.mocked(getAllAdapters).mockReturnValue([]);
    await registerWakeHooks("https://example.com");
    // Should not throw
  });

  it("skips always-on adapters (programmableWebhook: false)", async () => {
    const adapter = mockAdapter({ programmableWebhook: false });
    vi.mocked(getAllAdapters).mockReturnValue([adapter as unknown as WakeHookAdapter]);
    await registerWakeHooks("https://example.com");
    expect(adapter.registerWebhook).not.toHaveBeenCalled();
  });

  it("registers webhook for programmable adapters with correct URL", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAllAdapters).mockReturnValue([adapter as unknown as WakeHookAdapter]);
    await registerWakeHooks("https://example.com");
    expect(adapter.registerWebhook).toHaveBeenCalledWith(
      "https://example.com/api/v1/webhook/telegram",
    );
  });

  it("registers multiple programmable adapters", async () => {
    const telegram = mockAdapter({ channelId: "telegram", name: "Telegram" });
    const slack = mockAdapter({ channelId: "slack", name: "Slack" });
    vi.mocked(getAllAdapters).mockReturnValue([telegram, slack] as unknown as WakeHookAdapter[]);
    await registerWakeHooks("https://example.com");
    expect(telegram.registerWebhook).toHaveBeenCalled();
    expect(slack.registerWebhook).toHaveBeenCalled();
  });

  it("error in one adapter does not prevent registering others", async () => {
    const failing = mockAdapter({
      channelId: "telegram",
      name: "Telegram",
      registerWebhook: vi.fn(async () => {
        throw new Error("API down");
      }),
    });
    const working = mockAdapter({ channelId: "slack", name: "Slack" });
    vi.mocked(getAllAdapters).mockReturnValue([failing, working] as unknown as WakeHookAdapter[]);
    await registerWakeHooks("https://example.com");
    expect(working.registerWebhook).toHaveBeenCalled();
  });
});

describe("teardownWakeHooks", () => {
  it("no-ops when no adapters configured", async () => {
    vi.mocked(getAllAdapters).mockReturnValue([]);
    await teardownWakeHooks();
  });

  it("skips always-on adapters", async () => {
    const adapter = mockAdapter({ programmableWebhook: false });
    vi.mocked(getAllAdapters).mockReturnValue([adapter as unknown as WakeHookAdapter]);
    await teardownWakeHooks();
    expect(adapter.deleteWebhook).not.toHaveBeenCalled();
  });

  it("deletes webhook for programmable adapters", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAllAdapters).mockReturnValue([adapter as unknown as WakeHookAdapter]);
    await teardownWakeHooks();
    expect(adapter.deleteWebhook).toHaveBeenCalled();
  });

  it("error in one adapter does not prevent tearing down others", async () => {
    const failing = mockAdapter({
      channelId: "telegram",
      name: "Telegram",
      deleteWebhook: vi.fn(async () => {
        throw new Error("API error");
      }),
    });
    const working = mockAdapter({ channelId: "slack", name: "Slack" });
    vi.mocked(getAllAdapters).mockReturnValue([failing, working] as unknown as WakeHookAdapter[]);
    await teardownWakeHooks();
    expect(working.deleteWebhook).toHaveBeenCalled();
  });
});
