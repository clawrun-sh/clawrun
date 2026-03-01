import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an HMAC-SHA256 signature against a payload.
 * Returns true if the computed digest matches the expected hex string.
 */
export function verifyHmacSha256(secret: string, payload: string, expectedHex: string): boolean {
  const computed = createHmac("sha256", secret).update(payload).digest("hex");
  const bufA = Buffer.from(computed);
  const bufB = Buffer.from(expectedHex);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
