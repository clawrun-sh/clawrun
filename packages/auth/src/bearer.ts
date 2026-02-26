import { createLogger } from "@clawrun/logger";
import { verifyToken } from "./verify.js";
import { safeEqual, extractBearerToken } from "./compare.js";

const log = createLogger("auth");

/**
 * Require admin-level Bearer auth.
 *
 * Accepts either:
 *   1. A JWT signed with CLAWRUN_JWT_SECRET (scope: "admin") — used by the CLI.
 *   2. The raw CLAWRUN_CRON_SECRET — used by Vercel Cron (can't sign JWTs).
 *
 * Returns null on success, or a Response to send back on failure.
 * Fail-closed: returns 500 if required env vars are not configured.
 */
export async function requireBearerAuth(req: Request): Promise<Response | null> {
  const cronSecret = process.env.CLAWRUN_CRON_SECRET;
  const jwtSecret = process.env.CLAWRUN_JWT_SECRET;

  if (!cronSecret || !jwtSecret) {
    log.error("CLAWRUN_CRON_SECRET or CLAWRUN_JWT_SECRET is not configured — rejecting request");
    return new Response("Server misconfigured", { status: 500 });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 1. Try JWT verification (CLI sends short-lived admin JWTs)
  const payload = await verifyToken(token, jwtSecret);
  if (payload?.scope === "admin") return null;

  // 2. Fall back to raw cron secret (Vercel Cron sends static secret)
  if (safeEqual(token, cronSecret)) return null;

  return new Response("Unauthorized", { status: 401 });
}
