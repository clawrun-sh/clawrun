import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxHandle } from "@clawrun/agent";
import type { RuntimeConfig, SandboxLifecycleManager as SLMType } from "@clawrun/runtime";
import type { SandboxProvider } from "@clawrun/provider";

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: vi.fn().mockImplementation(
    class {
      getStatus = vi.fn(async () => ({ running: true, sandboxId: "sbx-1" }));
    },
  ),
  getRuntimeConfig: vi.fn(() => ({
    instance: { provider: "vercel" },
  })),
  resolveRoot: vi.fn(async () => "/home/user/.clawrun"),
}));

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(() => ({
    get: vi.fn(async () => mockSandbox),
  })),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

let mockSandbox: Partial<SandboxHandle>;

const MOCK_LOG_LINES = [
  '{"level":30,"time":1710000000000,"tag":"supervisor","msg":"daemon started"}',
  '{"level":40,"time":1710000001000,"tag":"heartbeat","msg":"missed beat"}',
  '{"level":50,"time":1710000002000,"tag":"supervisor","msg":"daemon crashed"}',
].join("\n");

function applyRuntimeMocks() {
  return import("@clawrun/runtime").then((runtimeMod) => {
    vi.mocked(runtimeMod.getRuntimeConfig).mockReturnValue({
      instance: { provider: "vercel" },
    } as RuntimeConfig);
    vi.mocked(runtimeMod.resolveRoot).mockResolvedValue("/home/user/.clawrun");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      class {
        getStatus = vi.fn(async () => ({ running: true, sandboxId: "sbx-1", status: "running" }));
      } as unknown as typeof SLMType,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSandbox = {
    readFile: vi.fn(async () => Buffer.from(MOCK_LOG_LINES)),
    runCommand: vi.fn(),
  };
});

describe("handleGetLogs", () => {
  let handleGetLogs: typeof import("./agent-logs.js").handleGetLogs;

  beforeEach(async () => {
    vi.resetModules();
    await applyRuntimeMocks();
    const providerMod = await import("@clawrun/provider");
    vi.mocked(providerMod.getProvider).mockReturnValue({
      get: vi.fn(async () => mockSandbox),
    } as unknown as SandboxProvider);
    const mod = await import("./agent-logs.js");
    handleGetLogs = mod.handleGetLogs;
  });

  it("returns 503 when sandbox is offline", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      class {
        getStatus = vi.fn(async () => ({ running: false, sandboxId: null }));
      } as unknown as typeof SLMType,
    );

    const req = new Request("http://localhost/api/v1/logs");
    const resp = await handleGetLogs(req);
    expect(resp.status).toBe(503);
  });

  it("returns parsed log entries", async () => {
    const req = new Request("http://localhost/api/v1/logs");
    const resp = await handleGetLogs(req);
    const body = await resp.json();

    expect(body.entries).toHaveLength(3);
    expect(body.entries[0]).toEqual({
      level: 30,
      time: 1710000000000,
      tag: "supervisor",
      msg: "daemon started",
    });
    expect(body.entries[2].level).toBe(50);
  });

  it("respects limit query param", async () => {
    const req = new Request("http://localhost/api/v1/logs?limit=2");
    const resp = await handleGetLogs(req);
    const body = await resp.json();

    expect(body.entries).toHaveLength(2);
    // Returns last N entries
    expect(body.entries[0].msg).toBe("missed beat");
    expect(body.entries[1].msg).toBe("daemon crashed");
  });

  it("returns empty entries when log file does not exist", async () => {
    vi.mocked(mockSandbox.readFile!).mockResolvedValue(null);

    const req = new Request("http://localhost/api/v1/logs");
    const resp = await handleGetLogs(req);
    const body = await resp.json();

    expect(body.entries).toEqual([]);
  });

  it("skips malformed log lines", async () => {
    vi.mocked(mockSandbox.readFile!).mockResolvedValue(
      Buffer.from('{"level":30,"time":1,"msg":"ok"}\nnot json\n{"level":40,"time":2,"msg":"warn"}'),
    );

    const req = new Request("http://localhost/api/v1/logs");
    const resp = await handleGetLogs(req);
    const body = await resp.json();

    expect(body.entries).toHaveLength(2);
  });
});
