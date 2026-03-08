import { describe, it, expect, vi, beforeEach } from "vitest";

const mockManager = {
  wake: vi.fn(async () => ({ status: "running", sandboxId: "sbx-1" })),
  gracefulStop: vi.fn(async () => ({ status: "stopped", sandboxId: "sbx-1" })),
  forceRestart: vi.fn(async () => ({ status: "running", sandboxId: "sbx-2" })),
};

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: vi.fn().mockImplementation(() => mockManager),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock NextResponse.json as a static method returning standard Response
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sandbox-start handler", () => {
  let POST: typeof import("./sandbox-start.js").POST;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./sandbox-start.js");
    POST = mod.POST;
  });

  it("returns result from manager.wake()", async () => {
    const req = new Request("http://localhost", { method: "POST" });
    const resp = await POST(req);
    const body = await resp.json();
    expect(body.status).toBe("running");
    expect(body.sandboxId).toBe("sbx-1");
  });

  it("returns 500 when wake fails", async () => {
    mockManager.wake.mockResolvedValueOnce({ status: "failed", error: "no provider" });
    const req = new Request("http://localhost", { method: "POST" });
    const resp = await POST(req);
    expect(resp.status).toBe(500);
  });

  it("returns 500 on unexpected error", async () => {
    mockManager.wake.mockRejectedValueOnce(new Error("crash"));
    const req = new Request("http://localhost", { method: "POST" });
    const resp = await POST(req);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error).toBe("crash");
  });
});

describe("sandbox-stop handler", () => {
  let POST: typeof import("./sandbox-stop.js").POST;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./sandbox-stop.js");
    POST = mod.POST;
  });

  it("returns result from manager.gracefulStop()", async () => {
    const req = new Request("http://localhost", { method: "POST" });
    const resp = await POST(req);
    const body = await resp.json();
    expect(body.status).toBe("stopped");
  });

  it("returns 500 when gracefulStop fails", async () => {
    mockManager.gracefulStop.mockResolvedValueOnce({ status: "failed", error: "snapshot failed" });
    const req = new Request("http://localhost", { method: "POST" });
    const resp = await POST(req);
    expect(resp.status).toBe(500);
  });
});

describe("sandbox-restart handler", () => {
  let POST: typeof import("./sandbox-restart.js").POST;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./sandbox-restart.js");
    POST = mod.POST;
  });

  it("returns result from manager.forceRestart()", async () => {
    const req = new Request("http://localhost", { method: "POST" });
    const resp = await POST(req);
    const body = await resp.json();
    expect(body.status).toBe("running");
    expect(body.sandboxId).toBe("sbx-2");
  });

  it("returns 500 when forceRestart fails", async () => {
    mockManager.forceRestart.mockResolvedValueOnce({ status: "failed", error: "lock failed" });
    const req = new Request("http://localhost", { method: "POST" });
    const resp = await POST(req);
    expect(resp.status).toBe(500);
  });
});
