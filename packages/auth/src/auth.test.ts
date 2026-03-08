import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signInviteToken, signUserToken, signSessionToken } from "./sign.js";
import { verifyToken } from "./verify.js";
import { generateSecret, getKey } from "./key.js";
import { safeEqual, extractBearerToken } from "./compare.js";
import { requireCronAuth } from "./bearer.js";
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
    expect(payload!.scope).toBe("invite");
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
// signUserToken + verifyToken roundtrip
// ---------------------------------------------------------------------------
describe("signUserToken + verifyToken", () => {
  it("user token has scope user", async () => {
    const token = await signUserToken(TEST_SECRET);
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.scope).toBe("user");
  });

  it("user token has sub user", async () => {
    const token = await signUserToken(TEST_SECRET);
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload!.sub).toBe("user");
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
    expect(payload!.scope).toBe("user");
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

describe("requireCronAuth", () => {
  const cronSecret = "test-cron-secret-value";

  beforeEach(() => {
    process.env.CLAWRUN_CRON_SECRET = cronSecret;
  });

  afterEach(() => {
    delete process.env.CLAWRUN_CRON_SECRET;
  });

  it("returns null for raw cron secret", async () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(await requireCronAuth(req)).toBeNull();
  });

  it("returns 401 when no Authorization header", async () => {
    const req = new Request("http://localhost");
    const resp = await requireCronAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 401 for a JWT (not raw cron secret)", async () => {
    const token = await signUserToken(TEST_SECRET);
    const req = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const resp = await requireCronAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 401 for invalid token that is not cron secret", async () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer totally-wrong" },
    });
    const resp = await requireCronAuth(req);
    expect(resp?.status).toBe(401);
  });

  it("returns 500 when env var not configured", async () => {
    delete process.env.CLAWRUN_CRON_SECRET;
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer something" },
    });
    const resp = await requireCronAuth(req);
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
