import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyEd25519 } from "./ed25519.js";

// Generate a real Ed25519 keypair for testing
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");

function signMessage(message: string): string {
  return sign(null, Buffer.from(message), privateKey).toString("hex");
}

describe("verifyEd25519", () => {
  it("returns true for valid signature", () => {
    const message = "1234567890:hello world";
    const sig = signMessage(message);

    expect(verifyEd25519(publicKeyHex, sig, message)).toBe(true);
  });

  it("returns false for wrong message", () => {
    const sig = signMessage("original message");

    expect(verifyEd25519(publicKeyHex, sig, "tampered message")).toBe(false);
  });

  it("returns false for malformed key", () => {
    const sig = signMessage("test");

    expect(verifyEd25519("not-hex", sig, "test")).toBe(false);
  });

  it("returns false for wrong key", () => {
    const { publicKey: otherKey } = generateKeyPairSync("ed25519");
    const otherHex = otherKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");
    const sig = signMessage("test");

    expect(verifyEd25519(otherHex, sig, "test")).toBe(false);
  });
});
