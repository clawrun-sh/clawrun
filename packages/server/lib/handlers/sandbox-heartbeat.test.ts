import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clawrun/auth", () => ({
  requireSandboxAuth: vi.fn(() => null),
}));

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: vi.fn(),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

// NextResponse.json must be mocked since it's a Next.js static method
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { requireSandboxAuth } from "@clawrun/auth";
import { SandboxLifecycleManager } from "@clawrun/runtime";

function heartbeatRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/sandbox/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  sandboxId: "sbx-1",
  lastChangedAt: Date.now(),
  root: "/home/user/.clawrun",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSandboxAuth).mockReturnValue(null);
});

describe("sandbox-heartbeat POST", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    // Re-apply mocks after resetModules
    vi.mocked(requireSandboxAuth).mockReturnValue(null);
    const mod = await import("./sandbox-heartbeat.js");
    POST = mod.POST;
  });

  it("rejects when sandbox auth fails", async () => {
    vi.mocked(requireSandboxAuth).mockReturnValue(new Response("Unauthorized", { status: 401 }));
    const req = heartbeatRequest(validPayload);
    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/v1/sandbox/heartbeat", {
      method: "POST",
      body: "not-json{{{",
    });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 400 when sandboxId is missing", async () => {
    const req = heartbeatRequest({ lastChangedAt: 123, root: "/root" });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("sandboxId");
  });

  it("returns 400 when sandboxId is not a string", async () => {
    const req = heartbeatRequest({ sandboxId: 123, lastChangedAt: 123, root: "/root" });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("sandboxId");
  });

  it("returns 400 when lastChangedAt is missing", async () => {
    const req = heartbeatRequest({ sandboxId: "sbx-1", root: "/root" });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("lastChangedAt");
  });

  it("returns 400 when lastChangedAt is not a number", async () => {
    const req = heartbeatRequest({
      sandboxId: "sbx-1",
      lastChangedAt: "not-a-number",
      root: "/root",
    });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("lastChangedAt");
  });

  it("returns 400 when root is missing", async () => {
    const req = heartbeatRequest({ sandboxId: "sbx-1", lastChangedAt: 123 });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("root");
  });

  it("delegates to handleExtend and returns result", async () => {
    const handleExtend = vi.fn(async () => ({ action: "extended" }));
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => ({ handleExtend }) as unknown as SandboxLifecycleManager,
    );

    const req = heartbeatRequest(validPayload);
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.action).toBe("extended");

    expect(handleExtend).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxId: "sbx-1",
        root: "/home/user/.clawrun",
      }),
    );
  });

  it("returns 500 when handleExtend returns error action", async () => {
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () =>
        ({
          handleExtend: vi.fn(async () => ({ action: "error", error: "boom" })),
        }) as unknown as SandboxLifecycleManager,
    );

    const req = heartbeatRequest(validPayload);
    const resp = await POST(req);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.action).toBe("error");
  });

  it("returns 500 when handleExtend throws", async () => {
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () =>
        ({
          handleExtend: vi.fn(async () => {
            throw new Error("internal failure");
          }),
        }) as unknown as SandboxLifecycleManager,
    );

    const req = heartbeatRequest(validPayload);
    const resp = await POST(req);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error).toContain("internal failure");
  });

  it("passes sandboxCreatedAt when present in payload", async () => {
    const handleExtend = vi.fn(async () => ({ action: "extended" }));
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => ({ handleExtend }) as unknown as SandboxLifecycleManager,
    );

    const req = heartbeatRequest({ ...validPayload, sandboxCreatedAt: 1000 });
    await POST(req);
    expect(handleExtend).toHaveBeenCalledWith(expect.objectContaining({ sandboxCreatedAt: 1000 }));
  });

  it("omits sandboxCreatedAt when not a number", async () => {
    const handleExtend = vi.fn(async () => ({ action: "extended" }));
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => ({ handleExtend }) as unknown as SandboxLifecycleManager,
    );

    const req = heartbeatRequest({ ...validPayload, sandboxCreatedAt: "not-a-number" });
    await POST(req);
    expect(handleExtend).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxCreatedAt: undefined }),
    );
  });
});
