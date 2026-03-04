import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clawrun/auth", () => ({
  verifyToken: vi.fn(),
  signSessionToken: vi.fn(async () => "mock-session-jwt"),
  SESSION_COOKIE: "clawrun-session",
}));

// Minimal Next.js mocks — only the surface used by accept.ts
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
    _cookieCalls: { name: string; value: string; options: unknown }[] = [];
    cookies = {
      set: (name: string, value: string, options: unknown) => {
        this._cookieCalls.push({ name, value, options });
      },
    };

    static redirect(url: URL | string, status = 307) {
      return new MockNextResponse(null, {
        status,
        headers: { Location: typeof url === "string" ? url : url.toString() },
      });
    }
  }

  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse };
});

import { verifyToken } from "@clawrun/auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("accept handler GET", () => {
  let GET: typeof import("./accept.js").GET;

  beforeEach(async () => {
    process.env.CLAWRUN_JWT_SECRET = "test-secret";
    vi.resetModules();
    // Re-import to pick up fresh mocks
    const mod = await import("./accept.js");
    GET = mod.GET;
  });

  afterEach(() => {
    delete process.env.CLAWRUN_JWT_SECRET;
  });

  it("redirects to /auth/expired when no token param", async () => {
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/auth/accept");
    const resp = await GET(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/auth/expired");
  });

  it("returns 500 when CLAWRUN_JWT_SECRET not configured", async () => {
    delete process.env.CLAWRUN_JWT_SECRET;
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/auth/accept?token=some-jwt");
    const resp = await GET(req);
    expect(resp.status).toBe(500);
  });

  it("redirects to /auth/expired for invalid token", async () => {
    vi.mocked(verifyToken).mockResolvedValue(null);
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/auth/accept?token=bad-jwt");
    const resp = await GET(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/auth/expired");
  });

  it("redirects to /auth/expired when sub is not invite", async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: "admin", scope: "chat" });
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/auth/accept?token=wrong-sub");
    const resp = await GET(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/auth/expired");
  });

  it("redirects to /auth/expired when scope is not chat", async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: "invite", scope: "admin" });
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/auth/accept?token=wrong-scope");
    const resp = await GET(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/auth/expired");
  });

  it("redirects to /chat with session cookie for valid invite token", async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: "invite", scope: "chat" });
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/auth/accept?token=valid-invite");
    const resp = await GET(req);
    expect(resp.status).toBe(307);
    expect(resp.headers.get("Location")).toContain("/chat");

    const cookieCalls = (resp as unknown as { _cookieCalls: { name: string; value: string; options: unknown }[] })._cookieCalls;
    expect(cookieCalls.length).toBe(1);
    expect(cookieCalls[0].name).toBe("clawrun-session");
    expect(cookieCalls[0].value).toBe("mock-session-jwt");
    expect(cookieCalls[0].options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("sets Referrer-Policy no-referrer on success", async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: "invite", scope: "chat" });
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/auth/accept?token=valid-invite");
    const resp = await GET(req);
    expect(resp.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
