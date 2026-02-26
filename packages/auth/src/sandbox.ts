import { createLogger } from "@clawrun/logger";
import { safeEqual, extractBearerToken } from "./compare.js";

const log = createLogger("auth");

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

  const token = extractBearerToken(req);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!safeEqual(token, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
