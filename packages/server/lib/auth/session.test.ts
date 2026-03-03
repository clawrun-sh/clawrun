import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateSecret, signInviteToken, signSessionToken, signAdminToken } from "@clawrun/auth";

const TEST_SECRET = generateSecret();

describe("verifySessionCookie", () => {
  let verifySessionCookie: typeof import("./session.js").verifySessionCookie;

  beforeEach(async () => {
    const mod = await import("./session.js");
    verifySessionCookie = mod.verifySessionCookie;
  });

  it("returns payload for valid session cookie", async () => {
    const token = await signSessionToken(TEST_SECRET);
    const cookie = `clawrun-session=${token}`;
    const result = await verifySessionCookie(cookie, TEST_SECRET);
    expect(result).not.toBeNull();
    expect(result!.scope).toBe("chat");
  });

  it("extracts token from cookie string with multiple cookies", async () => {
    const token = await signSessionToken(TEST_SECRET);
    const cookie = `other=abc; clawrun-session=${token}; another=xyz`;
    const result = await verifySessionCookie(cookie, TEST_SECRET);
    expect(result).not.toBeNull();
  });

  it("returns null for missing cookie", async () => {
    const result = await verifySessionCookie("", TEST_SECRET);
    expect(result).toBeNull();
  });

  it("returns null for invalid token in cookie", async () => {
    const cookie = "clawrun-session=invalid-jwt-token";
    const result = await verifySessionCookie(cookie, TEST_SECRET);
    expect(result).toBeNull();
  });

  it("returns null for non-chat scope token", async () => {
    const token = await signAdminToken(TEST_SECRET);
    const cookie = `clawrun-session=${token}`;
    const result = await verifySessionCookie(cookie, TEST_SECRET);
    expect(result).toBeNull();
  });
});

describe("requireSessionOrBearerAuth", () => {
  let requireSessionOrBearerAuth: typeof import("./session.js").requireSessionOrBearerAuth;

  beforeEach(async () => {
    process.env.CLAWRUN_JWT_SECRET = TEST_SECRET;
    const mod = await import("./session.js");
    requireSessionOrBearerAuth = mod.requireSessionOrBearerAuth;
  });

  afterEach(() => {
    delete process.env.CLAWRUN_JWT_SECRET;
  });

  it("returns null for valid session cookie", async () => {
    const token = await signSessionToken(TEST_SECRET);
    const req = new Request("http://localhost", {
      headers: { Cookie: `clawrun-session=${token}` },
    });
    expect(await requireSessionOrBearerAuth(req)).toBeNull();
  });

  it("returns null for valid Bearer token with chat scope", async () => {
    const token = await signInviteToken(TEST_SECRET);
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await requireSessionOrBearerAuth(req)).toBeNull();
  });

  it("returns 401 when no cookie and no Bearer header", async () => {
    const req = new Request("http://localhost");
    const resp = await requireSessionOrBearerAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 401 for Bearer token with admin scope (not chat)", async () => {
    const token = await signAdminToken(TEST_SECRET);
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const resp = await requireSessionOrBearerAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 500 when CLAWRUN_JWT_SECRET not configured", async () => {
    delete process.env.CLAWRUN_JWT_SECRET;
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer something" },
    });
    const resp = await requireSessionOrBearerAuth(req);
    expect(resp?.status).toBe(500);
  });

  it("falls through to Bearer when cookie is invalid", async () => {
    const validBearer = await signInviteToken(TEST_SECRET);
    const req = new Request("http://localhost", {
      headers: {
        Cookie: "clawrun-session=bad-token",
        Authorization: `Bearer ${validBearer}`,
      },
    });
    expect(await requireSessionOrBearerAuth(req)).toBeNull();
  });
});
