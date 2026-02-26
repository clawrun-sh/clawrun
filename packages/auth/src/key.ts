import { randomBytes } from "node:crypto";

/** Generate a 512-bit base64url secret (OWASP recommendation for HS256). */
export function generateSecret(): string {
  return randomBytes(64).toString("base64url");
}

/** Decode the base64url secret back to the original random bytes. */
export function getKey(secret: string): Uint8Array {
  const key = Buffer.from(secret, "base64url");
  if (key.length < 32) throw new Error("JWT signing key too short");
  return key;
}
