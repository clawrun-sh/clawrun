import { createLogger } from "@clawrun/logger";
import { safeEqual, extractBearerToken } from "./compare.js";

const log = createLogger("auth");

/**
 * Require cron-level Bearer auth.
 *
 * Accepts only the raw CLAWRUN_CRON_SECRET — used by Vercel Cron (can't sign JWTs).
 *
 * Returns null on success, or a Response to send back on failure.
 * Fail-closed: returns 500 if the required env var is not configured.
 */
export async function requireCronAuth(req: Request): Promise<Response | null> {
  const cronSecret = process.env.CLAWRUN_CRON_SECRET;

  if (!cronSecret) {
    log.error("CLAWRUN_CRON_SECRET is not configured — rejecting request");
    return new Response("Server misconfigured", { status: 500 });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (safeEqual(token, cronSecret)) return null;

  return new Response("Unauthorized", { status: 401 });
}
