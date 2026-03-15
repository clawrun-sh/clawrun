import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, SandboxHandle } from "@clawrun/agent";
import type { RuntimeConfig, SandboxLifecycleManager as SLMType } from "@clawrun/runtime";
import type { SandboxProvider } from "@clawrun/provider";

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: vi.fn().mockImplementation(
    class {
      getStatus = vi.fn(async () => ({ running: true, sandboxId: "sbx-1" }));
    },
  ),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockManagedSandbox = {
    runCommand: vi.fn(),
    domain: vi.fn(() => "https://sbx.example.com"),
  };
  mockAgent = {
    getThread: vi.fn(async () => [
      { id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "hi there" }] },
    ]),
  };
});

describe("history handler (legacy)", () => {
  let GET: typeof import("./history.js").GET;

  beforeEach(async () => {
    vi.resetModules();

    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.getAgent).mockReturnValue(mockAgent as Agent);
    vi.mocked(runtimeMod.getRuntimeConfig).mockReturnValue({
      instance: { provider: "vercel" },
    } as RuntimeConfig);
    vi.mocked(runtimeMod.resolveRoot).mockResolvedValue("/home/user/.clawrun");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      class {
        getStatus = vi.fn(async () => ({ running: true, sandboxId: "sbx-1", status: "running" }));
      } as unknown as typeof SLMType,
    );

    const providerMod = await import("@clawrun/runtime");
    vi.mocked(providerMod.getProvider).mockReturnValue({
      get: vi.fn(async () => mockManagedSandbox),
    } as unknown as SandboxProvider);

    const mod = await import("./history.js");
    GET = mod.GET;
  });

  it("returns empty when threadId is missing", async () => {
    const req = new Request("http://localhost/api/v1/history");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when threadId is blank", async () => {
    const req = new Request("http://localhost/api/v1/history?threadId=%20");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when sandbox is not running", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      class {
        getStatus = vi.fn(async () => ({ running: false, sandboxId: null, status: "stopped" }));
      } as unknown as typeof SLMType,
    );

    const req = new Request("http://localhost/api/v1/history?threadId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when agent lacks getThread", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.getAgent).mockReturnValue({} as Agent);

    const req = new Request("http://localhost/api/v1/history?threadId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns messages on success", async () => {
    const req = new Request("http://localhost/api/v1/history?threadId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("user");
  });

  it("returns empty on error (does not throw)", async () => {
    vi.mocked(mockAgent.getThread!).mockRejectedValueOnce(new Error("timeout"));

    const req = new Request("http://localhost/api/v1/history?threadId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body.messages).toEqual([]);
  });
});
