import { timingSafeEqual } from "node:crypto";
import { createLogger } from "@clawrun/logger";

const log = createLogger("auth");

/**
 * Timing-safe string comparison.
 * Returns false immediately if lengths differ (length is not secret),
 * then uses timingSafeEqual for constant-time content comparison.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Require Bearer token auth using CLAWRUN_CRON_SECRET.
 *
 * Returns null on success, or a Response to send back on failure.
 * Fail-closed: returns 500 if the secret env var is not configured.
 */
export function requireBearerAuth(req: Request): Response | null {
  const secret = process.env.CLAWRUN_CRON_SECRET;
  if (!secret) {
    log.error("CLAWRUN_CRON_SECRET is not configured — rejecting request");
    return new Response("Server misconfigured", { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = auth.slice("Bearer ".length);
  if (!safeEqual(token, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

/**
 * Require sandbox-tier auth using CLAWRUN_SANDBOX_SECRET.
 *
 * Used by the sandbox extend loop callback. This secret is injected into the
 * sandbox — keeping it separate from CLAWRUN_CRON_SECRET means untrusted agent code
 * inside the sandbox cannot call admin endpoints (restart, stop).
 *
 * Returns null on success, or a Response to send back on failure.
 * Fail-closed: returns 500 if the secret env var is not configured.
 */
export function requireSandboxAuth(req: Request): Response | null {
  const secret = process.env.CLAWRUN_SANDBOX_SECRET;
  if (!secret) {
    log.error("CLAWRUN_SANDBOX_SECRET is not configured — rejecting request");
    return new Response("Server misconfigured", { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = auth.slice("Bearer ".length);
  if (!safeEqual(token, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
