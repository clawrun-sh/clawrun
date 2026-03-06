import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Agent, AgentResponse } from "@clawrun/agent";
import type { SandboxProvider } from "@clawrun/provider";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "mock-secret-key\n"),
}));

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(),
  snapshotId: (id: string) => id,
}));

vi.mock("../agents/registry.js", () => ({
  getAgent: vi.fn(),
}));

vi.mock("../config.js", () => ({
  getRuntimeConfig: vi.fn(() => ({
    instance: { provider: "vercel" },
    sandbox: { resources: { vcpus: 2 } },
  })),
}));

vi.mock("./resolve-root.js", () => ({
  resolveRoot: vi.fn(async () => "/home/user/.clawrun"),
}));

import { getProvider } from "@clawrun/provider";
import { getAgent } from "../agents/registry.js";

function mockSandbox(overrides: Record<string, unknown> = {}) {
  return {
    stop: vi.fn(async () => {}),
    ...overrides,
  };
}

function mockAgent(overrides: Record<string, unknown> = {}) {
  return {
    provision: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => ({ success: true, message: "Agent reply" })),
    ...overrides,
  };
}

describe("runAgent", () => {
  // runner.ts caches the provider in a module-level singleton (_provider).
  // We must resetModules + re-import before each test to get a fresh cache.
  let runAgent: (message: string, options?: { agentId?: string }) => Promise<AgentResponse>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.CLAWRUN_SANDBOX_SNAPSHOT_ID;
    const mod = await import("./runner.js");
    runAgent = mod.runAgent;
  });

  afterEach(() => {
    delete process.env.CLAWRUN_SANDBOX_SNAPSHOT_ID;
  });

  it("creates sandbox, provisions agent, sends message, stops sandbox", async () => {
    const sandbox = mockSandbox();
    vi.mocked(getProvider).mockReturnValue({
      create: vi.fn(async () => sandbox),
    } as unknown as SandboxProvider);

    const agent = mockAgent();
    vi.mocked(getAgent).mockReturnValue(agent as unknown as Agent);

    const result = await runAgent("Hello");

    expect(result.success).toBe(true);
    expect(result.message).toBe("Agent reply");
    expect(agent.provision).toHaveBeenCalled();
    expect(agent.sendMessage).toHaveBeenCalledWith(
      sandbox,
      "/home/user/.clawrun",
      "Hello",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sandbox.stop).toHaveBeenCalled();
  });

  it("stops sandbox even when sendMessage throws", async () => {
    const sandbox = mockSandbox();
    vi.mocked(getProvider).mockReturnValue({
      create: vi.fn(async () => sandbox),
    } as unknown as SandboxProvider);

    const agent = mockAgent({
      sendMessage: vi.fn(async () => {
        throw new Error("agent error");
      }),
    });
    vi.mocked(getAgent).mockReturnValue(agent as unknown as Agent);

    const result = await runAgent("Hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("agent error");
    expect(sandbox.stop).toHaveBeenCalled();
  });

  it("returns error response when provider.create throws", async () => {
    vi.mocked(getProvider).mockReturnValue({
      create: vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    const result = await runAgent("Hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("quota exceeded");
  });

  it("includes API response body in error message", async () => {
    const apiError = new Error("Bad Request") as Error & { json?: unknown };
    apiError.json = { code: "INVALID_CONFIG", detail: "missing field" };

    vi.mocked(getProvider).mockReturnValue({
      create: vi.fn(async () => {
        throw apiError;
      }),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    const result = await runAgent("Hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Bad Request");
    expect(result.error).toContain("INVALID_CONFIG");
  });

  it("passes snapshotId when CLAWRUN_SANDBOX_SNAPSHOT_ID is set", async () => {
    process.env.CLAWRUN_SANDBOX_SNAPSHOT_ID = "snap-123";
    // Re-import after setting env var so the fresh module reads it
    vi.resetModules();
    const mod = await import("./runner.js");
    runAgent = mod.runAgent;

    const create = vi.fn(async () => mockSandbox());
    vi.mocked(getProvider).mockReturnValue({ create } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    await runAgent("Hello");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "snap-123" }));
  });

  it("does not pass snapshotId when env var is not set", async () => {
    const create = vi.fn(async () => mockSandbox());
    vi.mocked(getProvider).mockReturnValue({ create } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    await runAgent("Hello");
    const arg = (create.mock.calls as unknown[][])[0][0];
    expect(arg).not.toHaveProperty("snapshotId");
  });

  it("forwards timeout and vcpus to provider.create()", async () => {
    const create = vi.fn(async () => mockSandbox());
    vi.mocked(getProvider).mockReturnValue({ create } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    await runAgent("Hello");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 60_000,
        resources: { vcpus: 2 },
      }),
    );
  });

  it("caches the provider across calls (singleton)", async () => {
    const create = vi.fn(async () => mockSandbox());
    const provider = { create };
    vi.mocked(getProvider).mockReturnValue(provider as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    await runAgent("First");
    await runAgent("Second");

    // getProvider should only be called once — subsequent calls reuse the cached provider
    expect(getProvider).toHaveBeenCalledTimes(1);
  });

  it("does not crash when sandbox.stop throws (best-effort cleanup)", async () => {
    const sandbox = mockSandbox({
      stop: vi.fn(async () => {
        throw new Error("stop failed");
      }),
    });
    vi.mocked(getProvider).mockReturnValue({
      create: vi.fn(async () => sandbox),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    const result = await runAgent("Hello");
    expect(result.success).toBe(true);
  });

  it("passes agentId to getAgent when provided", async () => {
    vi.mocked(getProvider).mockReturnValue({
      create: vi.fn(async () => mockSandbox()),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue(mockAgent() as unknown as Agent);

    await runAgent("Hello", { agentId: "custom-agent" });
    expect(getAgent).toHaveBeenCalledWith("custom-agent");
  });
});
