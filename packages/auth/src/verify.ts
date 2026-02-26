import { jwtVerify, errors } from "jose";
import { ALGORITHM, ISSUER, AUDIENCE, SUB_TO_TYP } from "./constants.js";
import { getKey } from "./key.js";

export interface TokenPayload {
  /** Subject — "invite" | "session" | "admin". */
  sub: string;
  /** Scope — "chat" for user access, "admin" for lifecycle operations. */
  scope: string;
}

/**
 * Verify a JWT token (invite, session, or admin).
 *
 * Returns the decoded payload on success, or null if the token is
 * invalid, expired, or signed with a different secret.
 */
export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, getKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
      maxTokenAge: "7d",
      clockTolerance: "30s",
      requiredClaims: ["scope"],
    });
    // Validate sub is known and typ header matches (RFC 8725 §3.11)
    const sub = payload.sub;
    if (!sub || !(sub in SUB_TO_TYP)) return null;
    if (protectedHeader.typ !== SUB_TO_TYP[sub]) return null;
    return {
      sub,
      scope: (payload.scope as string) ?? "",
    };
  } catch (err) {
    if (
      err instanceof errors.JWTExpired ||
      err instanceof errors.JWSSignatureVerificationFailed ||
      err instanceof errors.JWTClaimValidationFailed ||
      err instanceof errors.JWSInvalid ||
      err instanceof errors.JWTInvalid ||
      err instanceof errors.JOSEAlgNotAllowed ||
      err instanceof errors.JOSENotSupported
    ) {
      return null;
    }
    throw err;
  }
}
