import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateSecret, signUserToken, signSessionToken, signInviteToken } from "@clawrun/auth";

// Only mock next/server — all auth functions are REAL
vi.mock("next/server", () => {
  class MockNextRequest extends Request {
    nextUrl: URL;
    constructor(input: string | URL, init?: RequestInit) {
      const urlStr = typeof input === "string" ? input : input.toString();
      super(urlStr, init);
      this.nextUrl = new URL(urlStr);
    }
  }

  class MockNextResponse extends Response {
    _deletedCookies: string[] = [];
    cookies = {
      delete: (name: string) => {
        this._deletedCookies.push(name);
      },
    };

    static next() {
      return new MockNextResponse(null, { status: 200, headers: { "x-proxy": "next" } });
    }

    static redirect(url: URL | string, status = 307) {
      return new MockNextResponse(null, {
        status,
        headers: { Location: typeof url === "string" ? url : url.toString() },
      });
    }
  }

  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse };
});

const JWT_SECRET = generateSecret();
const CRON_SECRET = "test-cron-secret-value";
const SANDBOX_SECRET = "test-sandbox-secret-value";

let proxy: typeof import("./proxy.js").proxy;
let NextRequest: typeof import("next/server").NextRequest;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.CLAWRUN_JWT_SECRET = JWT_SECRET;
  process.env.CLAWRUN_CRON_SECRET = CRON_SECRET;
  process.env.CLAWRUN_SANDBOX_SECRET = SANDBOX_SECRET;

  vi.resetModules();
  const proxyMod = await import("./proxy.js");
  proxy = proxyMod.proxy;
  const nextMod = await import("next/server");
  NextRequest = nextMod.NextRequest;
});

afterEach(() => {
  delete process.env.CLAWRUN_JWT_SECRET;
  delete process.env.CLAWRUN_CRON_SECRET;
  delete process.env.CLAWRUN_SANDBOX_SECRET;
});

function isPassThrough(resp: Response): boolean {
  return resp.status === 200 && resp.headers.get("x-proxy") === "next";
}

// ---------------------------------------------------------------------------
// Webhook routes — no auth required
// ---------------------------------------------------------------------------
describe("webhook routes — no auth", () => {
  it("passes through without any credentials", async () => {
    const req = new NextRequest("http://localhost/api/v1/webhook/telegram", { method: "POST" });
    expect(isPassThrough(await proxy(req))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sandbox heartbeat — requires sandbox secret
// ---------------------------------------------------------------------------
describe("/api/v1/sandbox/heartbeat — sandbox secret", () => {
  it("rejects requests without credentials", async () => {
    const req = new NextRequest("http://localhost/api/v1/sandbox/heartbeat", { method: "POST" });
    const resp = await proxy(req);
    expect(resp.status).toBe(401);
  });

  it("rejects requests with wrong secret", async () => {
    const req = new NextRequest("http://localhost/api/v1/sandbox/heartbeat", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const resp = await proxy(req);
    expect(resp.status).toBe(401);
  });

  it("rejects requests with a valid user JWT (wrong auth type)", async () => {
    const jwt = await signUserToken(JWT_SECRET);
    const req = new NextRequest("http://localhost/api/v1/sandbox/heartbeat", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const resp = await proxy(req);
    expect(resp.status).toBe(401);
  });

  it("passes through with correct sandbox secret", async () => {
    const req = new NextRequest("http://localhost/api/v1/sandbox/heartbeat", {
      method: "POST",
      headers: { Authorization: `Bearer ${SANDBOX_SECRET}` },
    });
    expect(isPassThrough(await proxy(req))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat (cron) — requires cron secret
// ---------------------------------------------------------------------------
describe("/api/v1/heartbeat — cron secret", () => {
  it("rejects requests without credentials", async () => {
    const req = new NextRequest("http://localhost/api/v1/heartbeat");
    const resp = await proxy(req);
    expect(resp.status).toBe(401);
  });

  it("rejects requests with a valid user JWT (wrong auth type)", async () => {
    const jwt = await signUserToken(JWT_SECRET);
    const req = new NextRequest("http://localhost/api/v1/heartbeat", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const resp = await proxy(req);
    expect(resp.status).toBe(401);
  });

  it("passes through with correct cron secret", async () => {
    const req = new NextRequest("http://localhost/api/v1/heartbeat", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(isPassThrough(await proxy(req))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// API routes — requires user auth (session cookie or user Bearer JWT)
// ---------------------------------------------------------------------------
describe("API routes — user auth", () => {
  const protectedPaths = [
    "/api/v1/chat",
    "/api/v1/sandbox/start",
    "/api/v1/sandbox/stop",
    "/api/v1/sandbox/restart",
    "/api/v1/health",
    "/api/v1/history",
    "/api/v1/threads",
    "/api/v1/status",
    "/api/v1/config",
  ];

  for (const path of protectedPaths) {
    it(`rejects ${path} without credentials`, async () => {
      const req = new NextRequest(`http://localhost${path}`, { method: "POST" });
      const resp = await proxy(req);
      expect(resp.status).toBe(401);
    });
  }

  it("rejects requests with invite-scoped JWT (wrong scope)", async () => {
    const jwt = await signInviteToken(JWT_SECRET);
    const req = new NextRequest("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const resp = await proxy(req);
    expect(resp.status).toBe(401);
  });

  it("rejects requests with cron secret (wrong auth type)", async () => {
    const req = new NextRequest("http://localhost/api/v1/sandbox/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const resp = await proxy(req);
    expect(resp.status).toBe(401);
  });

  it("passes through with valid user Bearer JWT", async () => {
    const jwt = await signUserToken(JWT_SECRET);
    const req = new NextRequest("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(isPassThrough(await proxy(req))).toBe(true);
  });

  it("passes through with valid session cookie", async () => {
    const sessionJwt = await signSessionToken(JWT_SECRET);
    const req = new NextRequest("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { Cookie: `clawrun-session=${sessionJwt}` },
    });
    expect(isPassThrough(await proxy(req))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dashboard pages — requires session cookie (redirects on failure)
// ---------------------------------------------------------------------------
describe("dashboard pages — session cookie", () => {
  it("redirects to /auth/expired without session cookie", async () => {
    const req = new NextRequest("http://localhost/chat");
    const resp = await proxy(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/auth/expired");
  });

  it("redirects to /auth/expired with invalid session cookie", async () => {
    const req = new NextRequest("http://localhost/threads", {
      headers: { Cookie: "clawrun-session=invalid-jwt" },
    });
    const resp = await proxy(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/auth/expired");
  });

  it("redirects to /auth/expired with invite JWT in cookie (wrong scope)", async () => {
    const inviteJwt = await signInviteToken(JWT_SECRET);
    const req = new NextRequest("http://localhost/chat", {
      headers: { Cookie: `clawrun-session=${inviteJwt}` },
    });
    const resp = await proxy(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/auth/expired");
  });

  it("passes through with valid session cookie", async () => {
    const sessionJwt = await signSessionToken(JWT_SECRET);
    const req = new NextRequest("http://localhost/chat", {
      headers: { Cookie: `clawrun-session=${sessionJwt}` },
    });
    expect(isPassThrough(await proxy(req))).toBe(true);
  });

  it("returns 500 when CLAWRUN_JWT_SECRET is not configured", async () => {
    delete process.env.CLAWRUN_JWT_SECRET;
    const req = new NextRequest("http://localhost/chat");
    const resp = await proxy(req);
    expect(resp.status).toBe(500);
  });
});
