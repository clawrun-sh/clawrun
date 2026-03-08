import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, SandboxHandle } from "@clawrun/agent";
import type { RuntimeConfig, SandboxLifecycleManager as SLMType } from "@clawrun/runtime";
import type { SandboxProvider } from "@clawrun/provider";

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: vi.fn().mockImplementation(() => ({
    getStatus: vi.fn(async () => ({ running: true, sandboxId: "sbx-1" })),
  })),
  getProvider: vi.fn(() => ({
    get: vi.fn(async () => mockManagedSandbox),
  })),
  getRuntimeConfig: vi.fn(() => ({
    instance: { provider: "vercel" },
  })),
  resolveRoot: vi.fn(async () => "/home/user/.clawrun"),
  getAgent: vi.fn(() => mockAgent),
}));

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(() => ({
    get: vi.fn(async () => mockManagedSandbox),
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

let mockManagedSandbox: Partial<SandboxHandle>;
let mockAgent: Partial<Agent>;

const MOCK_THREADS = [
  {
    id: "clawrun_abc123",
    channel: "ClawRun",
    preview: "hello world",
    messageCount: 4,
    lastActivity: "2025-01-01T12:00:00Z",
  },
  {
    id: "telegram_john",
    channel: "Telegram",
    preview: "hi there",
    messageCount: 2,
    lastActivity: "2025-01-01T10:00:00Z",
  },
];

const MOCK_MESSAGES = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "hi there" }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockManagedSandbox = {
    runCommand: vi.fn(),
    domain: vi.fn(() => "https://sbx.example.com"),
  };
  mockAgent = {
    listThreads: vi.fn(async () => MOCK_THREADS),
    getThread: vi.fn(async () => MOCK_MESSAGES),
  };
});

function applyRuntimeMocks() {
  return import("@clawrun/runtime").then((runtimeMod) => {
    vi.mocked(runtimeMod.getAgent).mockReturnValue(mockAgent as Agent);
    vi.mocked(runtimeMod.getRuntimeConfig).mockReturnValue({
      instance: { provider: "vercel" },
    } as RuntimeConfig);
    vi.mocked(runtimeMod.resolveRoot).mockResolvedValue("/home/user/.clawrun");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      (() => ({
        getStatus: vi.fn(async () => ({ running: true, sandboxId: "sbx-1", status: "running" })),
      })) as unknown as typeof SLMType,
    );
    vi.mocked(runtimeMod.getProvider).mockReturnValue({
      get: vi.fn(async () => mockManagedSandbox),
    } as unknown as SandboxProvider);
  });
}

// ---------------------------------------------------------------------------
// handleListThreads — GET /api/v1/threads
// ---------------------------------------------------------------------------
describe("handleListThreads", () => {
  let handleListThreads: typeof import("./threads.js").handleListThreads;

  beforeEach(async () => {
    vi.resetModules();
    await applyRuntimeMocks();
    const mod = await import("./threads.js");
    handleListThreads = mod.handleListThreads;
  });

  it("returns empty when sandbox is not running", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      (() => ({
        getStatus: vi.fn(async () => ({ running: false, sandboxId: null, status: "stopped" })),
      })) as unknown as typeof SLMType,
    );

    const req = new Request("http://localhost/api/v1/threads");
    const resp = await handleListThreads(req);
    const body = await resp.json();

    expect(body.threads).toEqual([]);
  });

  it("returns empty when agent lacks listThreads", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.getAgent).mockReturnValue({} as Agent);

    const req = new Request("http://localhost/api/v1/threads");
    const resp = await handleListThreads(req);
    const body = await resp.json();

    expect(body.threads).toEqual([]);
  });

  it("returns threads on success", async () => {
    const req = new Request("http://localhost/api/v1/threads");
    const resp = await handleListThreads(req);
    const body = await resp.json();

    expect(body.threads).toHaveLength(2);
    expect(body.threads[0].id).toBe("clawrun_abc123");
    expect(body.threads[1].channel).toBe("Telegram");
  });

  it("returns empty on error (does not throw)", async () => {
    vi.mocked(mockAgent.listThreads!).mockRejectedValueOnce(new Error("timeout"));

    const req = new Request("http://localhost/api/v1/threads");
    const resp = await handleListThreads(req);
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body.threads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleGetThread — GET /api/v1/threads/:threadId
// ---------------------------------------------------------------------------
describe("handleGetThread", () => {
  let handleGetThread: typeof import("./threads.js").handleGetThread;

  beforeEach(async () => {
    vi.resetModules();
    await applyRuntimeMocks();
    const mod = await import("./threads.js");
    handleGetThread = mod.handleGetThread;
  });

  it("returns empty when threadId is blank", async () => {
    const req = new Request("http://localhost/api/v1/threads/");
    const resp = await handleGetThread(req, "  ");
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when sandbox is not running", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      (() => ({
        getStatus: vi.fn(async () => ({ running: false, sandboxId: null, status: "stopped" })),
      })) as unknown as typeof SLMType,
    );

    const req = new Request("http://localhost/api/v1/threads/clawrun_abc123");
    const resp = await handleGetThread(req, "clawrun_abc123");
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when agent lacks getThread", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.getAgent).mockReturnValue({} as Agent);

    const req = new Request("http://localhost/api/v1/threads/clawrun_abc123");
    const resp = await handleGetThread(req, "clawrun_abc123");
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns messages on success", async () => {
    const req = new Request("http://localhost/api/v1/threads/clawrun_abc123");
    const resp = await handleGetThread(req, "clawrun_abc123");
    const body = await resp.json();

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[1].role).toBe("assistant");
  });

  it("passes threadId to agent.getThread", async () => {
    const req = new Request("http://localhost/api/v1/threads/telegram_john");
    await handleGetThread(req, "telegram_john");

    expect(mockAgent.getThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "telegram_john",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns empty on error (does not throw)", async () => {
    vi.mocked(mockAgent.getThread!).mockRejectedValueOnce(new Error("timeout"));

    const req = new Request("http://localhost/api/v1/threads/clawrun_abc123");
    const resp = await handleGetThread(req, "clawrun_abc123");
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body.messages).toEqual([]);
  });
});
