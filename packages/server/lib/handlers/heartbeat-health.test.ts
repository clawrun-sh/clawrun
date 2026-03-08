import { describe, it, expect, vi, beforeEach } from "vitest";

const mockManager = {
  heartbeat: vi.fn(async () => ({ status: "running", sandboxId: "sbx-1" })),
  getStatus: vi.fn(async () => ({ running: true, sandboxId: "sbx-1", status: "running" })),
};

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: vi.fn().mockImplementation(() => mockManager),
  getRuntimeConfig: vi.fn(() => ({
    agent: { name: "zeroclaw" },
    instance: { provider: "vercel" },
  })),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

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

// --- heartbeat handler ---

describe("heartbeat handler", () => {
  let GET: typeof import("./heartbeat.js").GET;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./heartbeat.js");
    GET = mod.GET;
  });

  it("returns heartbeat result on success", async () => {
    const req = new Request("http://localhost/api/v1/heartbeat");
    const resp = await GET(req);
    const body = await resp.json();

    expect(resp.status).toBe(200);
    expect(body.status).toBe("running");
    expect(body.sandboxId).toBe("sbx-1");
  });

  it("returns 500 when heartbeat status is failed", async () => {
    mockManager.heartbeat.mockResolvedValueOnce({ status: "failed", error: "no provider" });
    const req = new Request("http://localhost/api/v1/heartbeat");
    const resp = await GET(req);

    expect(resp.status).toBe(500);
  });

  it("returns 500 on unexpected error", async () => {
    mockManager.heartbeat.mockRejectedValueOnce(new Error("crash"));
    const req = new Request("http://localhost/api/v1/heartbeat");
    const resp = await GET(req);

    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error).toBe("crash");
  });
});

// --- health handler ---

describe("health handler", () => {
  let GET: typeof import("./health.js").GET;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./health.js");
    GET = mod.GET;
  });

  it("returns ok with agent name and sandbox status", async () => {
    const resp = await GET();
    const body = await resp.json();

    expect(body.status).toBe("ok");
    expect(body.agent).toBe("zeroclaw");
    expect(body.provider).toBe("vercel");
    expect(body.sandbox.running).toBe(true);
  });

  it("returns sandbox running false on error", async () => {
    mockManager.getStatus.mockRejectedValueOnce(new Error("unavailable"));
    const resp = await GET();
    const body = await resp.json();

    expect(body.status).toBe("ok");
    expect(body.sandbox.running).toBe(false);
  });
});
