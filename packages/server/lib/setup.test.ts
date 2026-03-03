import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetHooks = vi.fn();
const mockTeardownWakeHooks = vi.fn(async () => {});
const mockRegisterWakeHooks = vi.fn(async () => {});
const mockInitializeAdapters = vi.fn();

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: { setHooks: mockSetHooks },
}));

vi.mock("@clawrun/channel", () => ({
  teardownWakeHooks: mockTeardownWakeHooks,
  registerWakeHooks: mockRegisterWakeHooks,
  initializeAdapters: mockInitializeAdapters,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setupLifecycleHooks", () => {
  let setupLifecycleHooks: typeof import("./setup.js").setupLifecycleHooks;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./setup.js");
    setupLifecycleHooks = mod.setupLifecycleHooks;
  });

  it("registers hooks with lifecycle manager", () => {
    setupLifecycleHooks();

    expect(mockSetHooks).toHaveBeenCalledWith({
      onSandboxStarted: expect.any(Function),
      onSandboxStopped: expect.any(Function),
    });
  });

  it("onSandboxStarted calls teardownWakeHooks", async () => {
    setupLifecycleHooks();
    const hooks = mockSetHooks.mock.calls[0][0];

    await hooks.onSandboxStarted();

    expect(mockTeardownWakeHooks).toHaveBeenCalled();
  });

  it("onSandboxStopped calls registerWakeHooks with baseUrl", async () => {
    setupLifecycleHooks();
    const hooks = mockSetHooks.mock.calls[0][0];

    await hooks.onSandboxStopped("https://my-bot.vercel.app");

    expect(mockRegisterWakeHooks).toHaveBeenCalledWith("https://my-bot.vercel.app");
  });

  it("onSandboxStopped skips registerWakeHooks when baseUrl is null", async () => {
    setupLifecycleHooks();
    const hooks = mockSetHooks.mock.calls[0][0];

    await hooks.onSandboxStopped(null);

    expect(mockRegisterWakeHooks).not.toHaveBeenCalled();
  });
});

describe("initializeWakeHookAdapters", () => {
  let initializeWakeHookAdapters: typeof import("./setup.js").initializeWakeHookAdapters;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./setup.js");
    initializeWakeHookAdapters = mod.initializeWakeHookAdapters;
  });

  it("reads agent setup and initializes adapters", () => {
    const agent = {
      readSetup: vi.fn(() => ({
        channels: { telegram: { bot_token: "123" } },
      })),
    } as any;
    const config = {
      agent: { config: "agent/config.toml" },
      secrets: { webhookSecrets: { telegram: "tg-secret" } },
    } as any;

    initializeWakeHookAdapters(agent, config);

    expect(agent.readSetup).toHaveBeenCalled();
    expect(mockInitializeAdapters).toHaveBeenCalledWith(
      { telegram: { bot_token: "123" } },
      { telegram: "tg-secret" },
    );
  });

  it("handles missing secrets gracefully", () => {
    const agent = {
      readSetup: vi.fn(() => ({ channels: {} })),
    } as any;
    const config = {
      agent: { config: "agent/config.toml" },
    } as any;

    initializeWakeHookAdapters(agent, config);

    expect(mockInitializeAdapters).toHaveBeenCalledWith({}, {});
  });
});
