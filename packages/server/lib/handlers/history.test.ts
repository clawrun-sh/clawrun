import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../auth/session", () => ({
  requireSessionOrBearerAuth: vi.fn(async () => null),
}));

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

import { requireSessionOrBearerAuth } from "../auth/session";

let mockManagedSandbox: any;
let mockAgent: any;

beforeEach(() => {
  vi.clearAllMocks();
  mockManagedSandbox = {
    runCommand: vi.fn(),
    domain: vi.fn(() => "https://sbx.example.com"),
  };
  mockAgent = {
    fetchHistory: vi.fn(async () => [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]),
  };
});

describe("history handler", () => {
  let GET: typeof import("./history.js").GET;

  beforeEach(async () => {
    vi.resetModules();

    // Re-apply mock values after resetModules
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.getAgent).mockReturnValue(mockAgent);
    vi.mocked(runtimeMod.getRuntimeConfig).mockReturnValue({
      instance: { provider: "vercel" },
    } as any);
    vi.mocked(runtimeMod.resolveRoot).mockResolvedValue("/home/user/.clawrun");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(() => ({
      getStatus: vi.fn(async () => ({ running: true, sandboxId: "sbx-1", status: "running" })),
    }) as any);

    const providerMod = await import("@clawrun/runtime");
    vi.mocked(providerMod.getProvider).mockReturnValue({
      get: vi.fn(async () => mockManagedSandbox),
    } as any);

    const mod = await import("./history.js");
    GET = mod.GET;
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(requireSessionOrBearerAuth).mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const req = new Request("http://localhost/api/v1/history?sessionId=s1");
    const resp = await GET(req);

    expect(resp.status).toBe(401);
  });

  it("returns empty when sessionId is missing", async () => {
    const req = new Request("http://localhost/api/v1/history");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when sessionId is blank", async () => {
    const req = new Request("http://localhost/api/v1/history?sessionId=%20");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when sandbox is not running", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(() => ({
      getStatus: vi.fn(async () => ({ running: false, sandboxId: null, status: "stopped" })),
    }) as any);

    const req = new Request("http://localhost/api/v1/history?sessionId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns empty when agent lacks fetchHistory", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.getAgent).mockReturnValue({} as any);

    const req = new Request("http://localhost/api/v1/history?sessionId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toEqual([]);
  });

  it("returns messages on success", async () => {
    const req = new Request("http://localhost/api/v1/history?sessionId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("user");
  });

  it("returns empty on error (does not throw)", async () => {
    mockAgent.fetchHistory.mockRejectedValueOnce(new Error("timeout"));

    const req = new Request("http://localhost/api/v1/history?sessionId=s1");
    const resp = await GET(req);
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body.messages).toEqual([]);
  });
});
