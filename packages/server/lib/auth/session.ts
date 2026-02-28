import { verifyToken, extractBearerToken, SESSION_COOKIE } from "@clawrun/auth";
import type { TokenPayload } from "@clawrun/auth";

/**
 * Extract and verify the session JWT from the cookie header.
 *
 * Shared between the handler-level guard and the Next.js middleware.
 * Returns the payload on success, or null if the cookie is missing/invalid.
 */
export async function verifySessionCookie(
  cookieHeader: string,
  secret: string,
): Promise<TokenPayload | null> {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const payload = await verifyToken(match[1], secret);
  if (!payload || payload.scope !== "chat") return null;
  return payload;
}

/**
 * Require a valid JWT from either:
 *   1. `clawrun-session` cookie (web browser), or
 *   2. `Authorization: Bearer <jwt>` header (CLI).
 *
 * Returns null on success, or a Response to send back on failure.
 */
export async function requireSessionOrBearerAuth(req: Request): Promise<Response | null> {
  const secret = process.env.CLAWRUN_JWT_SECRET;
  if (!secret) {
    return new Response("Server misconfigured", { status: 500 });
  }

  // 1. Try cookie
  const cookieHeader = req.headers.get("cookie") ?? "";
  if (await verifySessionCookie(cookieHeader, secret)) return null;

  // 2. Try Bearer header
  const token = extractBearerToken(req);
  if (token) {
    const payload = await verifyToken(token, secret);
    if (payload?.scope === "chat") return null;
  }

  return new Response("Unauthorized", { status: 401 });
}
