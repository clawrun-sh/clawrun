import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ManagedSandbox, SandboxInfo, SandboxProvider, SnapshotInfo } from "@clawrun/provider";
import type { Agent, CronInfo, DaemonCommand, MonitorConfig } from "@clawrun/agent";
import type { StateStore } from "../storage/state-types.js";
import type { RuntimeConfig } from "../config.js";
import type { ExtendPayload } from "./lifecycle.js";

function mockRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    instance: {
      name: "test-instance",
      provider: "vercel",
      baseUrl: "https://test.example.com",
      sandboxRoot: ".clawrun",
    },
    agent: { name: "zeroclaw", config: "config.toml", bundlePaths: [] },
    sandbox: {
      activeDuration: 600,
      cronKeepAliveWindow: 900,
      cronWakeLeadTime: 60,
      resources: { vcpus: 2, memory: 4096 },
      networkPolicy: "allow-all",
    },
    ...overrides,
  } as RuntimeConfig;
}

let _configOverride: RuntimeConfig = mockRuntimeConfig();

function mockSandboxInfo(overrides?: Partial<SandboxInfo>): SandboxInfo {
  return {
    id: "sbx-1",
    status: "running",
    createdAt: Date.now() - 60_000,
    startedAt: Date.now() - 60_000,
    timeout: 6_000_000,
    memory: 4096,
    vcpus: 2,
    ...overrides,
  };
}

function mockManagedSandbox(overrides?: Partial<ManagedSandbox>): ManagedSandbox {
  return {
    id: "sbx-1",
    status: "running",
    timeout: 6_000_000,
    createdAt: Date.now() - 60_000,
    runCommand: vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: async () => "/home/user", stderr: async () => "" }),
    updateNetworkPolicy: vi.fn().mockResolvedValue(undefined),
    writeFiles: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("log output")),
    stop: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue({ id: "snap-new" }),
    extendTimeout: vi.fn().mockResolvedValue(undefined),
    domain: vi.fn().mockReturnValue("https://sbx-1.example.com"),
    ...overrides,
  } as unknown as ManagedSandbox;
}

function mockProvider(overrides?: Partial<SandboxProvider>): SandboxProvider {
  const sandbox = mockManagedSandbox();
  return {
    create: vi.fn().mockResolvedValue(sandbox),
    get: vi.fn().mockResolvedValue(sandbox),
    list: vi.fn().mockResolvedValue([]),
    listSnapshots: vi.fn().mockResolvedValue([]),
    deleteSnapshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockAgent(): Agent {
  return {
    id: "zeroclaw",
    name: "ZeroClaw",
    channelsConfigKey: "channels",
    daemonPort: 3000,
    provision: vi.fn().mockResolvedValue(undefined),
    getEnabledTools: vi.fn().mockReturnValue([]),
    getAvailableTools: vi.fn().mockReturnValue([]),
    sendMessage: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
    getDaemonCommand: vi
      .fn()
      .mockReturnValue({ cmd: "zeroclaw", args: ["serve"], env: {} } as DaemonCommand),
    getCrons: vi.fn().mockResolvedValue({ jobs: [] } as CronInfo),
    getMonitorConfig: vi
      .fn()
      .mockReturnValue({ dir: "/home/user/.clawrun", ignoreFiles: [] } as MonitorConfig),
    getProviders: vi.fn().mockReturnValue([]),
    getDefaultModel: vi.fn().mockReturnValue("gpt-4"),
    getCuratedModels: vi.fn().mockReturnValue([]),
    getModelsFetchEndpoint: vi.fn().mockReturnValue(null),
    getSupportedChannels: vi.fn().mockReturnValue([]),
    writeSetupConfig: vi.fn(),
    readSetup: vi.fn().mockReturnValue(null),
    getToolDomains: vi.fn().mockReturnValue([]),
    getLocalOwnedFiles: vi.fn().mockReturnValue([]),
    getBundleFiles: vi.fn().mockReturnValue([]),
    getInstallDependencies: vi.fn().mockReturnValue({}),
    getSeedDirectory: vi.fn().mockReturnValue(null),
    getBinaryBundlePaths: vi.fn().mockReturnValue([]),
  } as unknown as Agent;
}

function mockStateStore(): StateStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function mockExtendPayload(overrides?: Partial<ExtendPayload>): ExtendPayload {
  return {
    sandboxId: "sbx-1",
    lastChangedAt: Date.now() - 10_000, // 10s ago = recent activity
    sandboxCreatedAt: Date.now() - 60_000,
    root: "/home/user/.clawrun",
    daemonStatus: "running",
    daemonRestarts: 0,
    ...overrides,
  };
}

let _provider: SandboxProvider;
let _agent: Agent;
let _stateStore: StateStore;

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(() => _provider),
  CountBasedRetention: vi.fn().mockImplementation(() => ({
    selectForDeletion: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock("../agents/registry.js", () => ({
  getAgent: vi.fn(() => _agent),
}));

vi.mock("../config.js", () => ({
  getRuntimeConfig: vi.fn(() => _configOverride),
}));

vi.mock("../storage/state.js", () => ({
  getStateStore: vi.fn(() => _stateStore),
}));

vi.mock("./lock.js", () => ({
  tryAcquireCreationLock: vi.fn().mockResolvedValue("nonce-123"),
  releaseCreationLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./resolve-root.js", () => ({
  resolveRoot: vi.fn().mockResolvedValue("/home/user/.clawrun"),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((...args: unknown[]) => {
      // Return string when encoding is specified (readBundledSecretKey, readBundledCloudclawJson)
      // Return Buffer when no encoding (sidecar bundle read)
      const encoding = typeof args[1] === "string" ? args[1] : undefined;
      if (encoding) return "mock-file-content";
      return Buffer.from("// sidecar bundle");
    }),
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// Lazy import to ensure mocks are wired before module loads
let SandboxLifecycleManager: typeof import("./lifecycle.js").SandboxLifecycleManager;
let lockMod: typeof import("./lock.js");

beforeEach(async () => {
  // Full module reset ensures vi.mock factories re-run with fresh vi.fn() instances
  vi.resetModules();

  _configOverride = mockRuntimeConfig();
  _provider = mockProvider();
  _agent = mockAgent();
  _stateStore = mockStateStore();

  process.env.CLAWRUN_SANDBOX_SECRET = "test-secret";

  // Stub setTimeout to fire callbacks instantly (avoids 5s/2s/1s real delays in lifecycle code)
  const _realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => {
    return _realSetTimeout(() => fn(), 0);
  });

  // Global fetch mock for sidecar health checks — returns healthy immediately
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ daemon: { status: "running", pid: 42, restarts: 0 } }),
    }),
  );

  // Fresh import each time so constructor re-reads mocks
  const mod = await import("./lifecycle.js");
  SandboxLifecycleManager = mod.SandboxLifecycleManager;
  lockMod = await import("./lock.js");

  // Re-set lock mock defaults (previous tests may have overridden them)
  vi.mocked(lockMod.tryAcquireCreationLock).mockResolvedValue("nonce-123");
  vi.mocked(lockMod.releaseCreationLock).mockResolvedValue(undefined);

  // Re-set fs mock defaults (previous tests may have overridden existsSync)
  const fs = await import("node:fs");
  vi.mocked(fs.existsSync).mockReturnValue(true);

  // Reset static hooks
  SandboxLifecycleManager.setHooks({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLAWRUN_SANDBOX_SECRET;
});

// Helper: construct manager (after mocks are set)
function createManager() {
  return new SandboxLifecycleManager();
}

describe("heartbeat()", () => {
  it("returns running sandbox when one exists", async () => {
    const info = mockSandboxInfo({ id: "sbx-active", status: "running" });
    vi.mocked(_provider.list).mockResolvedValue([info]);

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("running");
    expect(result.sandboxId).toBe("sbx-active");
  });

  it("returns newest sandbox when multiple active", async () => {
    const older = mockSandboxInfo({ id: "sbx-old", status: "running", createdAt: 1000 });
    const newer = mockSandboxInfo({ id: "sbx-new", status: "running", createdAt: 2000 });
    vi.mocked(_provider.list).mockResolvedValue([older, newer]);

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.sandboxId).toBe("sbx-new");
  });

  it("wakes for cron when deadline is reached", async () => {
    const now = Date.now();
    // No active sandboxes
    vi.mocked(_provider.list).mockResolvedValue([]);
    // Next wake is 30s from now, lead time is 60s → deadline already passed
    vi.mocked(_stateStore.get).mockResolvedValue(new Date(now + 30_000).toISOString());

    // startNew needs these
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-woken" });
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("running");
    expect(_provider.create).toHaveBeenCalled();
  });

  it("does NOT wake when cron deadline is not yet reached", async () => {
    const now = Date.now();
    // No active, but has stopped sandboxes
    const stopped = mockSandboxInfo({
      id: "sbx-stopped",
      status: "stopped",
      stoppedAt: now - 5000,
    });
    vi.mocked(_provider.list).mockResolvedValue([stopped]);
    // Next wake is far away (10 min from now, lead time is 60s)
    vi.mocked(_stateStore.get).mockResolvedValue(new Date(now + 600_000).toISOString());

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("stopped");
    expect(result.nextWakeAt).toBeDefined();
    expect(_provider.create).not.toHaveBeenCalled();
  });

  it("wakes on first boot (no sandboxes ever existed)", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_stateStore.get).mockResolvedValue(null);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-first" });
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("running");
  });

  it("returns stopped with nextWakeAt when sleeping with scheduled cron", async () => {
    const now = Date.now();
    const wakeAt = new Date(now + 600_000).toISOString();
    const stopped = mockSandboxInfo({ id: "sbx-old", status: "stopped", stoppedAt: now - 5000 });
    vi.mocked(_provider.list).mockResolvedValue([stopped]);
    vi.mocked(_stateStore.get).mockResolvedValue(wakeAt);

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("stopped");
    expect(result.nextWakeAt).toBe(wakeAt);
  });

  it("returns stopped when no cron scheduled and not first boot", async () => {
    const stopped = mockSandboxInfo({
      id: "sbx-old",
      status: "stopped",
      stoppedAt: Date.now() - 5000,
    });
    vi.mocked(_provider.list).mockResolvedValue([stopped]);
    vi.mocked(_stateStore.get).mockResolvedValue(null);

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("stopped");
    expect(result.nextWakeAt).toBeUndefined();
  });
});

describe("wake()", () => {
  it("returns existing sandbox if one is running", async () => {
    const info = mockSandboxInfo({ id: "sbx-running", status: "running" });
    vi.mocked(_provider.list).mockResolvedValue([info]);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(result.sandboxId).toBe("sbx-running");
    expect(_provider.create).not.toHaveBeenCalled();
  });

  it("starts new sandbox when none active", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-new" });
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(_provider.create).toHaveBeenCalled();
  });

  it("tears down wake hooks after starting (default)", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    const onStarted = vi.fn().mockResolvedValue(undefined);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: onStarted,
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(onStarted).toHaveBeenCalled();
  });

  it("skips teardown when skipTeardownWakeHooks: true", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    const onStarted = vi.fn().mockResolvedValue(undefined);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: onStarted,
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake({ skipTeardownWakeHooks: true });

    expect(onStarted).not.toHaveBeenCalled();
  });
});

describe("handleExtend()", () => {
  it("returns error when provider.get throws", async () => {
    vi.mocked(_provider.get).mockRejectedValue(new Error("Not found"));

    const mgr = createManager();
    const result = await mgr.handleExtend(mockExtendPayload());

    expect(result.action).toBe("error");
    expect(result.error).toContain("Cannot get sandbox");
  });

  it("returns error when sandbox is not running", async () => {
    vi.mocked(_provider.get).mockResolvedValue(mockManagedSandbox({ status: "stopped" }));

    const mgr = createManager();
    const result = await mgr.handleExtend(mockExtendPayload());

    expect(result.action).toBe("error");
    expect(result.error).toContain("not running");
  });

  it("stops sandbox when daemon status is failed", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    // snapshotAndStop calls provider.get again to check status
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    // After stop, list returns empty for wake hooks check
    vi.mocked(_provider.list).mockResolvedValue([]);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({ daemonStatus: "failed", daemonRestarts: 5 }),
    );

    expect(result.action).toBe("stopped");
    expect(sandbox.snapshot).toHaveBeenCalled();
  });

  it("returns error when daemon failed AND snapshot fails", async () => {
    const sandbox = mockManagedSandbox({ status: "running" });
    vi.mocked(sandbox.snapshot).mockRejectedValue(new Error("Snapshot unavailable"));
    vi.mocked(_provider.get).mockResolvedValue(sandbox);

    const mgr = createManager();
    const result = await mgr.handleExtend(mockExtendPayload({ daemonStatus: "failed" }));

    expect(result.action).toBe("error");
    expect(result.error).toContain("Daemon failed");
  });

  it("extends TTL when file activity is recent AND TTL is low", async () => {
    const now = Date.now();
    // Sandbox with low remaining TTL (2 minutes left, buffer is 5 min)
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 300_000,
      timeout: 420_000, // 7 min total → deadline = createdAt + 420_000
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 300_000 }),
    );

    expect(result.action).toBe("extended");
    expect(sandbox.extendTimeout).toHaveBeenCalledWith(180_000);
  });

  it("skips extend call when reason exists but TTL is healthy", async () => {
    const now = Date.now();
    // Sandbox with plenty of TTL remaining (created 1 min ago, 100 min timeout)
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 60_000 }),
    );

    expect(result.action).toBe("extended");
    expect(sandbox.extendTimeout).not.toHaveBeenCalled();
  });

  it("stops sandbox when idle exceeds activeDuration", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ id: "sbx-idle", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    // After snapshot+stop, list returns empty
    vi.mocked(_provider.list).mockResolvedValue([]);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({
        lastChangedAt: now - 700_000, // idle > 600s activeDuration
        sandboxCreatedAt: now - 700_000,
      }),
    );

    expect(result.action).toBe("stopped");
  });

  it("persists nextCronAt to state when cron jobs exist", async () => {
    const now = Date.now();
    const nextRun = new Date(now + 300_000).toISOString();
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_agent.getCrons).mockResolvedValue({
      jobs: [{ nextRunAt: nextRun }],
    });

    const mgr = createManager();
    await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 60_000 }),
    );

    expect(_stateStore.set).toHaveBeenCalledWith("next_wake_at", expect.any(String));
  });

  it("clears nextCronAt from state when no cron jobs", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_agent.getCrons).mockResolvedValue({ jobs: [] });

    const mgr = createManager();
    await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 60_000 }),
    );

    expect(_stateStore.delete).toHaveBeenCalledWith("next_wake_at");
  });

  it("falls through to stop when extendTimeout throws", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 300_000,
      timeout: 420_000,
    });
    vi.mocked(sandbox.extendTimeout).mockRejectedValue(new Error("Plan ceiling"));
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([]);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 300_000 }),
    );

    expect(result.action).toBe("stopped");
  });

  it("registers wake hooks after stopping when no other active sandboxes", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([]); // no other active after stop
    const onStopped = vi.fn().mockResolvedValue(undefined);
    SandboxLifecycleManager.setHooks({ onSandboxStopped: onStopped });

    const mgr = createManager();
    await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 700_000, sandboxCreatedAt: now - 700_000 }),
    );

    expect(onStopped).toHaveBeenCalledWith("https://test.example.com");
  });

  it("skips wake hooks when other active sandboxes exist", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    // After stop, another sandbox is active
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-2", status: "running" }),
    ]);
    const onStopped = vi.fn().mockResolvedValue(undefined);
    SandboxLifecycleManager.setHooks({ onSandboxStopped: onStopped });

    const mgr = createManager();
    await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 700_000, sandboxCreatedAt: now - 700_000 }),
    );

    expect(onStopped).not.toHaveBeenCalled();
  });

  it("returns error when state.set fails for nextCronAt", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_agent.getCrons).mockResolvedValue({
      jobs: [{ nextRunAt: new Date(now + 60_000).toISOString() }],
    });
    vi.mocked(_stateStore.set).mockRejectedValue(new Error("Redis down"));

    const mgr = createManager();
    const result = await mgr.handleExtend(mockExtendPayload());

    expect(result.action).toBe("error");
    expect(result.error).toContain("persist");
  });

  it("handles getCrons failure gracefully (continues with empty crons)", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_agent.getCrons).mockRejectedValue(new Error("Agent unreachable"));

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 60_000 }),
    );

    // Should not error — continues with empty cron list and evaluates extend reasons
    expect(result.action).toBe("extended");
  });
});

describe("forceRestart()", () => {
  it("fails when lock cannot be acquired", async () => {
    vi.mocked(lockMod.tryAcquireCreationLock).mockResolvedValue(null);

    const mgr = createManager();
    const result = await mgr.forceRestart();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("lock");
  });

  it("snapshots active sandbox then starts new one", async () => {
    const oldSandbox = mockManagedSandbox({ id: "sbx-old", status: "running" });
    const newSandbox = mockManagedSandbox({ id: "sbx-new" });
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-old", status: "running" }),
    ]);
    vi.mocked(_provider.get).mockResolvedValue(oldSandbox);
    // create is called for the new sandbox
    vi.mocked(_provider.create).mockResolvedValue(newSandbox);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.forceRestart();

    expect(result.status).toBe("running");
    expect(oldSandbox.snapshot).toHaveBeenCalled();
    expect(_provider.create).toHaveBeenCalled();
  });

  it("stops extra sandboxes when multiple active", async () => {
    const newest = mockManagedSandbox({ id: "sbx-new", status: "running" });
    const oldest = mockManagedSandbox({ id: "sbx-old", status: "running" });
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-new", status: "running", createdAt: 2000 }),
      mockSandboxInfo({ id: "sbx-old", status: "running", createdAt: 1000 }),
    ]);
    // get returns the right sandbox based on id
    vi.mocked(_provider.get).mockImplementation(async (id: string) => {
      if (id === "sbx-new") return newest;
      return oldest;
    });
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-fresh" }));
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.forceRestart();

    // The oldest should be stopped via stopSandboxes
    expect(oldest.stop).toHaveBeenCalled();
  });

  it("returns failed when snapshot fails (sandbox kept running)", async () => {
    const sandbox = mockManagedSandbox({ status: "running" });
    vi.mocked(sandbox.snapshot).mockRejectedValue(new Error("Disk full"));
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);
    vi.mocked(_provider.get).mockResolvedValue(sandbox);

    const mgr = createManager();
    const result = await mgr.forceRestart();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Snapshot failed");
  });

  it("releases lock even on failure", async () => {
    vi.mocked(_provider.list).mockRejectedValue(new Error("API down"));

    const mgr = createManager();
    await expect(mgr.forceRestart()).rejects.toThrow("API down");

    expect(lockMod.releaseCreationLock).toHaveBeenCalledWith("nonce-123");
  });
});

describe("gracefulStop()", () => {
  it("registers wake hooks even when no active sandbox (idempotent)", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    const onStopped = vi.fn().mockResolvedValue(undefined);
    SandboxLifecycleManager.setHooks({ onSandboxStopped: onStopped });

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("stopped");
    expect(onStopped).toHaveBeenCalled();
  });

  it("snapshots+stops newest active sandbox", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("stopped");
    expect(result.sandboxId).toBe("sbx-1");
    expect(sandbox.snapshot).toHaveBeenCalled();
  });

  it("stops extra sandboxes beyond the newest", async () => {
    const newest = mockManagedSandbox({ id: "sbx-new", status: "running" });
    const extra = mockManagedSandbox({ id: "sbx-extra", status: "running" });
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-new", status: "running", createdAt: 2000 }),
      mockSandboxInfo({ id: "sbx-extra", status: "running", createdAt: 1000 }),
    ]);
    vi.mocked(_provider.get).mockImplementation(async (id: string) => {
      if (id === "sbx-new") return newest;
      return extra;
    });
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.gracefulStop();

    expect(extra.stop).toHaveBeenCalled();
  });

  it("returns failed when snapshot fails", async () => {
    const sandbox = mockManagedSandbox({ status: "running" });
    vi.mocked(sandbox.snapshot).mockRejectedValue(new Error("Disk full"));
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);
    vi.mocked(_provider.get).mockResolvedValue(sandbox);

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Snapshot failed");
  });

  it("returns stopped with error when wake hooks fail", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockRejectedValue(new Error("Webhook API down")),
    });

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("stopped");
    expect(result.error).toContain("Wake hooks failed");
  });
});

describe("getStatus()", () => {
  it("returns running with sandbox info", async () => {
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running", startedAt: 1000, createdAt: 900 }),
    ]);

    const mgr = createManager();
    const status = await mgr.getStatus();

    expect(status.running).toBe(true);
    expect(status.sandboxId).toBe("sbx-1");
  });

  it("returns not running with latest sandbox info", async () => {
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-old", status: "stopped", createdAt: 1000 }),
      mockSandboxInfo({ id: "sbx-older", status: "stopped", createdAt: 500 }),
    ]);

    const mgr = createManager();
    const status = await mgr.getStatus();

    expect(status.running).toBe(false);
    expect(status.sandboxId).toBe("sbx-old");
  });

  it("returns not running with no info", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);

    const mgr = createManager();
    const status = await mgr.getStatus();

    expect(status.running).toBe(false);
    expect(status.sandboxId).toBeUndefined();
  });
});

describe("startNew() (via wake)", () => {
  it("acquires lock, creates sandbox, releases lock", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-created" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(lockMod.tryAcquireCreationLock).toHaveBeenCalled();
    expect(lockMod.releaseCreationLock).toHaveBeenCalled();
  });

  it("on lock failure, returns running if sandbox appeared during wait", async () => {
    vi.mocked(lockMod.tryAcquireCreationLock).mockResolvedValue(null);
    // First call: no active (triggers startNew). Second call (after wait): active sandbox
    vi.mocked(_provider.list)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockSandboxInfo({ id: "sbx-appeared", status: "running" })]);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(result.sandboxId).toBe("sbx-appeared");
    expect(_provider.create).not.toHaveBeenCalled();
  });

  it("on lock failure, returns failed if no sandbox after wait", async () => {
    vi.mocked(lockMod.tryAcquireCreationLock).mockResolvedValue(null);
    vi.mocked(_provider.list).mockResolvedValue([]);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
  });
});

describe("startNewLocked() (via wake)", () => {
  it("resumes from latest snapshot when available", async () => {
    const snap: SnapshotInfo = { id: "snap-latest", createdAt: Date.now() - 10_000 };
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([snap]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-resumed" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(_provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: "snap-latest" }),
    );
  });

  it("falls through to fresh sandbox when snapshot resume fails", async () => {
    const snap: SnapshotInfo = { id: "snap-corrupt", createdAt: Date.now() - 10_000 };
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([snap]);
    vi.mocked(_provider.create)
      .mockRejectedValueOnce(new Error("Corrupt snapshot"))
      .mockResolvedValueOnce(mockManagedSandbox({ id: "sbx-fresh" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(_provider.create).toHaveBeenCalledTimes(2);
  });

  it("creates fresh sandbox when no snapshots exist", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-fresh" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(_provider.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ snapshotId: expect.anything() }),
    );
  });

  it("provisions agent with fromSnapshot: true when resumed", async () => {
    const snap: SnapshotInfo = { id: "snap-1", createdAt: Date.now() };
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([snap]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(_agent.provision).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ fromSnapshot: true }),
    );
  });

  it("provisions agent with fromSnapshot: false when fresh", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(_agent.provision).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ fromSnapshot: false }),
    );
  });

  it("applies network policy when not allow-all", async () => {
    _configOverride = mockRuntimeConfig({
      sandbox: {
        activeDuration: 600,
        cronKeepAliveWindow: 900,
        cronWakeLeadTime: 60,
        resources: { vcpus: 2, memory: 4096 },
        networkPolicy: { allow: ["api.openai.com"] },
      },
    } as Partial<RuntimeConfig>);

    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox();
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(sandbox.updateNetworkPolicy).toHaveBeenCalledWith({ allow: ["api.openai.com"] });
  });

  it("does not call updateNetworkPolicy when policy is allow-all", async () => {
    // Default config already uses "allow-all" — verify it's NOT called
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox();
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(sandbox.updateNetworkPolicy).not.toHaveBeenCalled();
  });

  it("passes deny-all policy to updateNetworkPolicy", async () => {
    _configOverride = mockRuntimeConfig({
      sandbox: {
        activeDuration: 600,
        cronKeepAliveWindow: 900,
        cronWakeLeadTime: 60,
        resources: { vcpus: 2, memory: 4096 },
        networkPolicy: "deny-all",
      },
    } as Partial<RuntimeConfig>);

    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox();
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(sandbox.updateNetworkPolicy).toHaveBeenCalledWith("deny-all");
  });

  it("passes complex policy with subnets to updateNetworkPolicy", async () => {
    const policy = {
      allow: ["api.openai.com", "openrouter.ai"],
      subnets: { deny: ["10.0.0.0/8"] },
    };
    _configOverride = mockRuntimeConfig({
      sandbox: {
        activeDuration: 600,
        cronKeepAliveWindow: 900,
        cronWakeLeadTime: 60,
        resources: { vcpus: 2, memory: 4096 },
        networkPolicy: policy,
      },
    } as Partial<RuntimeConfig>);

    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox();
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    expect(sandbox.updateNetworkPolicy).toHaveBeenCalledWith(policy);
  });

  it("returns failed when provider.create throws", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockRejectedValue(new Error("Quota exceeded"));

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
  });
});

describe("snapshotAndStop() / applyRetention()", () => {
  it("returns null (skips snapshot) when sandbox is not running", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "stopped" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }), // list says running
    ]);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    // gracefulStop calls snapshotAndStop which checks via provider.get
    const result = await mgr.gracefulStop();

    // Snapshot was skipped (provider.get returned stopped), so no snapshot call
    expect(sandbox.snapshot).not.toHaveBeenCalled();
    expect(result.status).toBe("stopped");
  });

  it("retries snapshot on first failure, succeeds on second", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(sandbox.snapshot)
      .mockRejectedValueOnce(new Error("Transient error"))
      .mockResolvedValueOnce({ id: "snap-ok" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("stopped");
    expect(sandbox.snapshot).toHaveBeenCalledTimes(2);
  });

  it("keeps sandbox running after all 3 retry failures", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(sandbox.snapshot).mockRejectedValue(new Error("Persistent error"));
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("failed");
    expect(sandbox.snapshot).toHaveBeenCalledTimes(3);
    expect(sandbox.stop).not.toHaveBeenCalled();
  });

  it("deletes old snapshots beyond keep count after successful snapshot", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);
    // After snapshot, retention cleanup finds 4 snapshots (keep 3, delete 1)
    const snapshots: SnapshotInfo[] = [
      { id: "snap-4", createdAt: 4000 },
      { id: "snap-3", createdAt: 3000 },
      { id: "snap-2", createdAt: 2000 },
      { id: "snap-1", createdAt: 1000 },
    ];
    vi.mocked(_provider.listSnapshots).mockResolvedValue(snapshots);

    // The mock CountBasedRetention from vi.mock returns []. Override it for this test.
    // We need the actual retention logic — re-import the mocked module and override selectForDeletion
    const { CountBasedRetention } = await import("@clawrun/provider");
    vi.mocked(CountBasedRetention).mockImplementation((() => ({
      selectForDeletion: vi.fn().mockReturnValue(["snap-1"]),
    })) as unknown as () => InstanceType<typeof CountBasedRetention>);

    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    // Re-create manager to pick up new retention mock
    const mgr = createManager();
    await mgr.gracefulStop();

    expect(_provider.deleteSnapshot).toHaveBeenCalledWith("snap-1");
  });

  it("applyRetention failure does not break snapshot flow", async () => {
    const sandbox = mockManagedSandbox({ id: "sbx-1", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-1", status: "running" }),
    ]);
    // listSnapshots throws during retention cleanup (called after snapshot succeeds)
    vi.mocked(_provider.listSnapshots).mockRejectedValue(new Error("Retention API down"));
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    // Snapshot succeeded despite retention failure
    expect(result.status).toBe("stopped");
    expect(sandbox.snapshot).toHaveBeenCalled();
  });
});

describe("isActive() with pending status", () => {
  it("heartbeat treats pending sandbox as active", async () => {
    const pending = mockSandboxInfo({ id: "sbx-pending", status: "pending", createdAt: 2000 });
    vi.mocked(_provider.list).mockResolvedValue([pending]);

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("running");
    expect(result.sandboxId).toBe("sbx-pending");
  });

  it("wake treats pending sandbox as active — does not create duplicate", async () => {
    const pending = mockSandboxInfo({ id: "sbx-pending", status: "pending" });
    vi.mocked(_provider.list).mockResolvedValue([pending]);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(result.sandboxId).toBe("sbx-pending");
    expect(_provider.create).not.toHaveBeenCalled();
  });
});

describe("stopSandboxes() (via gracefulStop/forceRestart)", () => {
  it("skips sandbox that stopped between list and get (race condition)", async () => {
    const newest = mockManagedSandbox({ id: "sbx-new", status: "running" });
    // Extra sandbox: list says running, but get returns stopped (race)
    const staleExtra = mockManagedSandbox({ id: "sbx-extra", status: "stopped" });
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-new", status: "running", createdAt: 2000 }),
      mockSandboxInfo({ id: "sbx-extra", status: "running", createdAt: 1000 }),
    ]);
    vi.mocked(_provider.get).mockImplementation(async (id: string) => {
      if (id === "sbx-new") return newest;
      return staleExtra; // already stopped by the time we get it
    });
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.gracefulStop();

    // staleExtra.stop should NOT be called — it's already stopped
    expect(staleExtra.stop).not.toHaveBeenCalled();
  });

  it("error stopping one sandbox does not prevent stopping others", async () => {
    const newest = mockManagedSandbox({ id: "sbx-new", status: "running" });
    const extraA = mockManagedSandbox({ id: "sbx-a", status: "running" });
    vi.mocked(extraA.stop).mockRejectedValue(new Error("API timeout"));
    const extraB = mockManagedSandbox({ id: "sbx-b", status: "running" });

    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-new", status: "running", createdAt: 3000 }),
      mockSandboxInfo({ id: "sbx-a", status: "running", createdAt: 2000 }),
      mockSandboxInfo({ id: "sbx-b", status: "running", createdAt: 1000 }),
    ]);
    vi.mocked(_provider.get).mockImplementation(async (id: string) => {
      if (id === "sbx-new") return newest;
      if (id === "sbx-a") return extraA;
      return extraB;
    });
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.gracefulStop();

    // extraA.stop threw, but extraB.stop should still be called
    expect(extraA.stop).toHaveBeenCalled();
    expect(extraB.stop).toHaveBeenCalled();
  });
});

describe("handleExtend() cron computation", () => {
  it("picks earliest future cron time from multiple jobs", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    const earliest = new Date(now + 120_000).toISOString();
    vi.mocked(_agent.getCrons).mockResolvedValue({
      jobs: [
        { nextRunAt: new Date(now + 300_000).toISOString() }, // 5 min
        { nextRunAt: earliest }, // 2 min — earliest
        { nextRunAt: new Date(now + 600_000).toISOString() }, // 10 min
      ],
    });

    const mgr = createManager();
    await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 60_000 }),
    );

    expect(_stateStore.set).toHaveBeenCalledWith("next_wake_at", earliest);
  });

  it("filters past cron jobs, picks earliest future one", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    const futureTime = new Date(now + 200_000).toISOString();
    vi.mocked(_agent.getCrons).mockResolvedValue({
      jobs: [
        { nextRunAt: new Date(now - 60_000).toISOString() }, // past — filtered
        { nextRunAt: new Date(now - 120_000).toISOString() }, // past — filtered
        { nextRunAt: futureTime }, // only future one
      ],
    });

    const mgr = createManager();
    await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 60_000 }),
    );

    expect(_stateStore.set).toHaveBeenCalledWith("next_wake_at", futureTime);
  });

  it("all cron jobs in the past — clears next_wake_at", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_agent.getCrons).mockResolvedValue({
      jobs: [
        { nextRunAt: new Date(now - 60_000).toISOString() },
        { nextRunAt: new Date(now - 120_000).toISOString() },
      ],
    });

    const mgr = createManager();
    await mgr.handleExtend(
      mockExtendPayload({ lastChangedAt: now - 10_000, sandboxCreatedAt: now - 60_000 }),
    );

    expect(_stateStore.delete).toHaveBeenCalledWith("next_wake_at");
    expect(_stateStore.set).not.toHaveBeenCalled();
  });

  it("stopped result carries correct nextWakeAt from computed cron", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ id: "sbx-idle", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([]);
    // Cron 30 min in future — BEYOND the 15min keep-alive window,
    // so CronScheduleReason does NOT fire and sandbox stops.
    const nextCron = new Date(now + 1_800_000).toISOString();
    vi.mocked(_agent.getCrons).mockResolvedValue({
      jobs: [{ nextRunAt: nextCron }],
    });
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({
        lastChangedAt: now - 700_000, // idle > activeDuration
        sandboxCreatedAt: now - 700_000,
      }),
    );

    expect(result.action).toBe("stopped");
    expect(result.nextWakeAt).toBe(nextCron);
  });
});

describe("handleExtend() eventual consistency", () => {
  it("excludes just-stopped sandbox from wake-hook decision", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ id: "sbx-stopping", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    // After stop, list still reports the JUST-STOPPED sandbox as running (eventual consistency)
    // plus no other active sandboxes
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-stopping", status: "running" }),
    ]);
    const onStopped = vi.fn().mockResolvedValue(undefined);
    SandboxLifecycleManager.setHooks({ onSandboxStopped: onStopped });

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({
        sandboxId: "sbx-stopping",
        lastChangedAt: now - 700_000,
        sandboxCreatedAt: now - 700_000,
      }),
    );

    // Should STILL register wake hooks — the self-exclusion filter
    // removes sbx-stopping from the "other active" check
    expect(result.action).toBe("stopped");
    expect(onStopped).toHaveBeenCalledWith("https://test.example.com");
  });

  it("cron within keep-alive window extends sandbox (CronScheduleReason)", async () => {
    const now = Date.now();
    // Sandbox that is idle (no file activity, past grace period) but has cron due soon
    const sandbox = mockManagedSandbox({
      status: "running",
      createdAt: now - 60_000,
      timeout: 6_000_000,
    });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    // cronKeepAliveWindow is 900s = 15min. Cron due in 5 min — within window.
    vi.mocked(_agent.getCrons).mockResolvedValue({
      jobs: [{ nextRunAt: new Date(now + 300_000).toISOString() }],
    });

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({
        lastChangedAt: now - 700_000, // idle > activeDuration (no FileActivityReason)
        sandboxCreatedAt: now - 700_000, // past grace period (no GracePeriodReason)
      }),
    );

    // CronScheduleReason should fire and extend
    expect(result.action).toBe("extended");
  });
});

describe("hook precondition guards", () => {
  it("registerWakeHooks throws when baseUrl is not configured", async () => {
    _configOverride = mockRuntimeConfig({
      instance: { name: "test", provider: "vercel", baseUrl: undefined, sandboxRoot: ".clawrun" },
    } as Partial<RuntimeConfig>);
    vi.mocked(_provider.list).mockResolvedValue([]);
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("stopped");
    expect(result.error).toContain("baseUrl");
  });

  it("registerWakeHooks throws when onSandboxStopped hook not initialized", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    // Hooks NOT set — onSandboxStopped is undefined
    SandboxLifecycleManager.setHooks({});

    const mgr = createManager();
    const result = await mgr.gracefulStop();

    expect(result.status).toBe("stopped");
    expect(result.error).toContain("lifecycle hooks not initialized");
  });

  it("teardownWakeHooks throws when onSandboxStarted hook not initialized", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    // onSandboxStarted NOT set
    SandboxLifecycleManager.setHooks({});

    const mgr = createManager();
    const result = await mgr.wake();

    // startNewLocked catches the teardownWakeHooks error
    expect(result.status).toBe("failed");
    expect(result.error).toContain("lifecycle hooks not initialized");
  });
});

describe("startSidecar() health check loop", () => {
  it("daemon reports 'failed' — breaks immediately, returns failed", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-fail" });
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    // Health check: daemon failed on first poll
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daemon: { status: "failed", restarts: 5 } }),
      }),
    );

    const mgr = createManager();
    const result = await mgr.wake();

    // startNewLocked catches the sidecar health error
    expect(result.status).toBe("failed");
    expect(result.error).toContain("daemon failed");
    // Should have broken out early — only 1 fetch call (not 15)
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("daemon 'starting' then 'running' — succeeds after polling", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-slow" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ daemon: { status: "starting" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ daemon: { status: "starting" } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ daemon: { status: "running", pid: 99 } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fetch throws network error — retries and succeeds", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ daemon: { status: "running", pid: 1 } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP 503 — retries and succeeds on next poll", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ daemon: { status: "running", pid: 1 } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("all retries exhausted — reads sidecar log, returns failed with diagnostics", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-stuck" });
    vi.mocked(sandbox.readFile).mockResolvedValue(Buffer.from("ERROR: port 3000 in use"));
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    // Always returns "starting" — never becomes "running"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daemon: { status: "starting" } }),
      }),
    );

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("health check failed");
    expect(result.error).toContain("port 3000 in use");
    // All 15 retries used
    expect(fetch).toHaveBeenCalledTimes(15);
  });

  it("missing CLAWRUN_SANDBOX_SECRET — returns failed", async () => {
    delete process.env.CLAWRUN_SANDBOX_SECRET;
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("CLAWRUN_SANDBOX_SECRET");
  });

  it("missing baseUrl — returns failed", async () => {
    _configOverride = mockRuntimeConfig({
      instance: { name: "test", provider: "vercel", baseUrl: undefined, sandboxRoot: ".clawrun" },
    } as Partial<RuntimeConfig>);
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("baseUrl");
  });

  it("sidecar bundle not found — returns failed", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());

    // Override existsSync to return false for sidecar bundle
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Sidecar bundle not found");
  });
});

describe("forceRestart() edge cases", () => {
  it("no active sandboxes — goes straight to startNewLocked", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-fresh" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.forceRestart();

    expect(result.status).toBe("running");
    expect(result.sandboxId).toBe("sbx-fresh");
    // No snapshot call — nothing to snapshot
    expect(_provider.get).not.toHaveBeenCalled();
  });
});

describe("heartbeat() edge cases", () => {
  it("failed sandbox exists (not running, no stoppedAt) — does NOT trigger first boot", async () => {
    // A sandbox exists with status "error" — hasEverRun is false (not running, no stoppedAt),
    // but sandboxes.length > 0, so first-boot check fails
    const errored = mockSandboxInfo({ id: "sbx-err", status: "error", stoppedAt: undefined });
    vi.mocked(_provider.list).mockResolvedValue([errored]);
    vi.mocked(_stateStore.get).mockResolvedValue(null);

    const mgr = createManager();
    const result = await mgr.heartbeat();

    expect(result.status).toBe("stopped");
    expect(_provider.create).not.toHaveBeenCalled();
  });
});

describe("startNewLocked() edge cases", () => {
  it("multiple snapshots — picks latest by createdAt", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([
      { id: "snap-old", createdAt: 1000 } as SnapshotInfo,
      { id: "snap-newest", createdAt: 3000 } as SnapshotInfo,
      { id: "snap-mid", createdAt: 2000 } as SnapshotInfo,
    ]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-resumed" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(_provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: "snap-newest" }),
    );
  });

  it("listSnapshots API throws — falls through to fresh sandbox", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockRejectedValue(new Error("Snapshot API unavailable"));
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox({ id: "sbx-fresh" }));
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("running");
    expect(result.sandboxId).toBe("sbx-fresh");
    // create called once (fresh), NOT with a snapshotId
    expect(_provider.create).toHaveBeenCalledTimes(1);
    expect(_provider.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ snapshotId: expect.anything() }),
    );
  });

  it("agent.provision throws — returns failed", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    vi.mocked(_provider.create).mockResolvedValue(mockManagedSandbox());
    vi.mocked(_agent.provision).mockRejectedValue(new Error("Binary corrupted"));

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Binary corrupted");
  });

  it("passes correct native TTL and writes clawrun.json into sandbox", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-provisioned" });
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    // activeDuration=600s → 600_000ms × 10 = 6_000_000ms native TTL
    expect(_provider.create).toHaveBeenCalledWith(expect.objectContaining({ timeout: 6_000_000 }));
    // clawrun.json written into sandbox workspace
    expect(sandbox.writeFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("clawrun.json") }),
      ]),
    );
  });
});

describe("stopSandboxes() provider.get failure", () => {
  it("provider.get throws for one sandbox — continues stopping others", async () => {
    const newest = mockManagedSandbox({ id: "sbx-new", status: "running" });
    const extraB = mockManagedSandbox({ id: "sbx-b", status: "running" });
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-new", status: "running", createdAt: 3000 }),
      mockSandboxInfo({ id: "sbx-gone", status: "running", createdAt: 2000 }),
      mockSandboxInfo({ id: "sbx-b", status: "running", createdAt: 1000 }),
    ]);
    vi.mocked(_provider.get).mockImplementation(async (id: string) => {
      if (id === "sbx-new") return newest;
      if (id === "sbx-gone") throw new Error("Sandbox not found");
      return extraB;
    });
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.gracefulStop();

    // sbx-gone threw on get, but sbx-b should still be stopped
    expect(extraB.stop).toHaveBeenCalled();
  });
});

describe("handleExtend() idle stop failures", () => {
  it("idle sandbox snapshot failure — returns error with sandbox kept running", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ id: "sbx-idle", status: "running" });
    vi.mocked(sandbox.snapshot).mockRejectedValue(new Error("Disk quota exceeded"));
    vi.mocked(_provider.get).mockResolvedValue(sandbox);

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({
        lastChangedAt: now - 700_000,
        sandboxCreatedAt: now - 700_000,
      }),
    );

    expect(result.action).toBe("error");
    expect(result.error).toContain("Snapshot failed");
    expect(result.error).toContain("sandbox kept running");
    // sandbox.stop should NOT have been called — state preserved
    expect(sandbox.stop).not.toHaveBeenCalled();
  });

  it("wake hook failure after successful stop — returns error", async () => {
    const now = Date.now();
    const sandbox = mockManagedSandbox({ id: "sbx-idle", status: "running" });
    vi.mocked(_provider.get).mockResolvedValue(sandbox);
    vi.mocked(_provider.list).mockResolvedValue([]); // no other active
    SandboxLifecycleManager.setHooks({
      onSandboxStopped: vi.fn().mockRejectedValue(new Error("Telegram API down")),
    });

    const mgr = createManager();
    const result = await mgr.handleExtend(
      mockExtendPayload({
        lastChangedAt: now - 700_000,
        sandboxCreatedAt: now - 700_000,
      }),
    );

    // Sandbox was stopped successfully, but wake hooks failed
    expect(result.action).toBe("error");
    expect(result.error).toContain("wake hooks failed");
    expect(sandbox.snapshot).toHaveBeenCalled();
  });
});

describe("getStatus() pending sandbox behavior", () => {
  it("reports pending sandbox as not running (uses raw status, not isActive)", async () => {
    vi.mocked(_provider.list).mockResolvedValue([
      mockSandboxInfo({ id: "sbx-pending", status: "pending", createdAt: 2000 }),
    ]);

    const mgr = createManager();
    const status = await mgr.getStatus();

    // getStatus checks s.status === "running", not isActive()
    // So pending shows as not running — different from heartbeat/wake
    expect(status.running).toBe(false);
    expect(status.sandboxId).toBe("sbx-pending");
    expect(status.status).toBe("pending");
  });
});

describe("startSidecar() diagnostics and security", () => {
  it("no sidecar log available — error includes '(no log output)'", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-nolog" });
    vi.mocked(sandbox.readFile).mockResolvedValue(null);
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daemon: { status: "starting" } }),
      }),
    );

    const mgr = createManager();
    const result = await mgr.wake();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("(no log output)");
  });

  it("passes CLAWRUN_HB_SECRET via env option, not in args", async () => {
    vi.mocked(_provider.list).mockResolvedValue([]);
    vi.mocked(_provider.listSnapshots).mockResolvedValue([]);
    const sandbox = mockManagedSandbox({ id: "sbx-secure" });
    vi.mocked(_provider.create).mockResolvedValue(sandbox);
    SandboxLifecycleManager.setHooks({
      onSandboxStarted: vi.fn().mockResolvedValue(undefined),
    });

    const mgr = createManager();
    await mgr.wake();

    // The detached runCommand call (last one) should pass secret via env
    const calls = vi.mocked(sandbox.runCommand).mock.calls;
    const detachedCall = calls.find(
      (c) => typeof c[0] === "object" && (c[0] as { detached?: boolean }).detached,
    );
    expect(detachedCall).toBeDefined();
    const opts = detachedCall![0] as { env?: Record<string, string>; args?: string[] };
    expect(opts.env).toHaveProperty("CLAWRUN_HB_SECRET", "test-secret");
    // Secret should NOT appear in args
    expect(opts.args?.join(" ")).not.toContain("test-secret");
  });
});
