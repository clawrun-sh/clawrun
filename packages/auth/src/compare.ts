import { timingSafeEqual } from "node:crypto";

/**
 * Timing-safe string comparison.
 * Returns false immediately if lengths differ (length is not secret),
 * then uses timingSafeEqual for constant-time content comparison.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header.
 * Returns null if the header is missing or not a Bearer token.
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length);
}
