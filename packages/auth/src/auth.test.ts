import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signInviteToken, signAdminToken, signSessionToken } from "./sign.js";
import { verifyToken } from "./verify.js";
import { generateSecret, getKey } from "./key.js";
import { safeEqual, extractBearerToken } from "./compare.js";
import { requireBearerAuth } from "./bearer.js";
import { requireSandboxAuth } from "./sandbox.js";

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const TEST_SECRET = generateSecret();

// ---------------------------------------------------------------------------
// signInviteToken + verifyToken roundtrip
// ---------------------------------------------------------------------------
describe("signInviteToken + verifyToken", () => {
  it("signed invite token verifies successfully", async () => {
    const token = await signInviteToken(TEST_SECRET);
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.scope).toBe("chat");
  });

  it("token with wrong secret fails verification", async () => {
    const token = await signInviteToken(TEST_SECRET);
    const otherSecret = generateSecret();
    const result = await verifyToken(token, otherSecret);
    expect(result).toBeNull();
  });

  it("malformed token returns null", async () => {
    const result = await verifyToken("not.a.valid.jwt", TEST_SECRET);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// signAdminToken + verifyToken roundtrip
// ---------------------------------------------------------------------------
describe("signAdminToken + verifyToken", () => {
  it("admin token has scope admin", async () => {
    const token = await signAdminToken(TEST_SECRET);
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.scope).toBe("admin");
  });

  it("admin token has sub admin", async () => {
    const token = await signAdminToken(TEST_SECRET);
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload!.sub).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// signSessionToken
// ---------------------------------------------------------------------------
describe("signSessionToken", () => {
  it("session token verifies with correct secret", async () => {
    const token = await signSessionToken(TEST_SECRET);
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.scope).toBe("chat");
  });
});

// ---------------------------------------------------------------------------
// generateSecret + getKey
// ---------------------------------------------------------------------------
describe("generateSecret + getKey", () => {
  it("generated secret decodes to 64 bytes", () => {
    const secret = generateSecret();
    const key = getKey(secret);
    expect(key.byteLength).toBe(64);
  });

  it("different calls produce different secrets", () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(s1).not.toBe(s2);
  });

  it("short secret throws in getKey", () => {
    // base64url of 16 bytes (< 32 threshold)
    const short = Buffer.from("short").toString("base64url");
    expect(() => getKey(short)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractBearerToken
// ---------------------------------------------------------------------------
describe("extractBearerToken", () => {
  it("extracts token from valid Bearer header", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer mytoken" },
    });
    expect(extractBearerToken(req)).toBe("mytoken");
  });

  it("returns null for missing header", () => {
    const req = new Request("http://localhost");
    expect(extractBearerToken(req)).toBeNull();
  });

  it("returns null for non-Bearer scheme", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(extractBearerToken(req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// safeEqual
// ---------------------------------------------------------------------------
describe("safeEqual", () => {
  it("returns true for equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(safeEqual("abc", "xyz")).toBe(false);
  });
});

describe("requireBearerAuth", () => {
  const cronSecret = "test-cron-secret-value";

  beforeEach(() => {
    process.env.CLAWRUN_JWT_SECRET = TEST_SECRET;
    process.env.CLAWRUN_CRON_SECRET = cronSecret;
  });

  afterEach(() => {
    delete process.env.CLAWRUN_JWT_SECRET;
    delete process.env.CLAWRUN_CRON_SECRET;
  });

  it("returns null for valid admin JWT", async () => {
    const token = await signAdminToken(TEST_SECRET);
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await requireBearerAuth(req)).toBeNull();
  });

  it("returns null for raw cron secret", async () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(await requireBearerAuth(req)).toBeNull();
  });

  it("returns 401 when no Authorization header", async () => {
    const req = new Request("http://localhost");
    const resp = await requireBearerAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 401 for chat-scoped JWT (not admin)", async () => {
    const token = await signInviteToken(TEST_SECRET);
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const resp = await requireBearerAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 401 for invalid token that is not cron secret", async () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer totally-wrong" },
    });
    const resp = await requireBearerAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 500 when env vars not configured", async () => {
    delete process.env.CLAWRUN_JWT_SECRET;
    delete process.env.CLAWRUN_CRON_SECRET;
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer something" },
    });
    const resp = await requireBearerAuth(req);
    expect(resp?.status).toBe(500);
  });
});

describe("requireSandboxAuth", () => {
  const sandboxSecret = "test-sandbox-secret";

  beforeEach(() => {
    process.env.CLAWRUN_SANDBOX_SECRET = sandboxSecret;
  });

  afterEach(() => {
    delete process.env.CLAWRUN_SANDBOX_SECRET;
  });

  it("returns null for valid sandbox secret", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${sandboxSecret}` },
    });
    expect(requireSandboxAuth(req)).toBeNull();
  });

  it("returns 401 when no Authorization header", () => {
    const req = new Request("http://localhost");
    expect(requireSandboxAuth(req)?.status).toBe(401);
  });

  it("returns 401 for wrong secret", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(requireSandboxAuth(req)?.status).toBe(401);
  });

  it("returns 500 when CLAWRUN_SANDBOX_SECRET not configured", () => {
    delete process.env.CLAWRUN_SANDBOX_SECRET;
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer something" },
    });
    expect(requireSandboxAuth(req)?.status).toBe(500);
  });
});
