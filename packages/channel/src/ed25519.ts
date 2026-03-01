import { verify, createPublicKey } from "node:crypto";

/**
 * Verify an Ed25519 signature.
 *
 * @param publicKeyHex - The Ed25519 public key as a hex string (32 bytes = 64 hex chars).
 * @param signature    - The signature as a hex string.
 * @param message      - The message that was signed (typically timestamp + body).
 * @returns true if the signature is valid.
 */
export function verifyEd25519(publicKeyHex: string, signature: string, message: string): boolean {
  try {
    // Ed25519 public key DER prefix (for a 32-byte key)
    const ED25519_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
    const rawKey = Buffer.from(publicKeyHex, "hex");
    const derKey = Buffer.concat([ED25519_DER_PREFIX, rawKey]);

    const key = createPublicKey({ key: derKey, format: "der", type: "spki" });
    return verify(null, Buffer.from(message), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
