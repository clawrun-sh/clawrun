import { SignJWT } from "jose";
import { ALGORITHM, ISSUER, AUDIENCE, DEFAULT_TTL, SESSION_TTL } from "./constants.js";
import { getKey } from "./key.js";
import type { TokenPayload } from "./verify.js";

/**
 * Sign a short-lived invite JWT (scope: "chat", sub: "invite").
 *
 * Used by the CLI to generate invite links and chat Bearer tokens.
 *
 * @param secret  - The signing secret (CLAWRUN_JWT_SECRET).
 * @param ttl     - Expiry as a `jose` time span string (e.g. "10m", "1h").
 *                  Defaults to 10 minutes.
 */
export async function signInviteToken(secret: string, ttl: string = DEFAULT_TTL): Promise<string> {
  return new SignJWT({ scope: "chat" } satisfies Pick<TokenPayload, "scope">)
    .setProtectedHeader({ alg: ALGORITHM, typ: "invite+jwt" })
    .setSubject("invite")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getKey(secret));
}

/**
 * Sign a short-lived admin JWT (scope: "admin", sub: "admin").
 *
 * Used by the CLI to call lifecycle endpoints (start, stop, restart).
 *
 * @param secret  - The signing secret (CLAWRUN_JWT_SECRET).
 * @param ttl     - Expiry as a `jose` time span string. Defaults to 10 minutes.
 */
export async function signAdminToken(secret: string, ttl: string = DEFAULT_TTL): Promise<string> {
  return new SignJWT({ scope: "admin" } satisfies Pick<TokenPayload, "scope">)
    .setProtectedHeader({ alg: ALGORITHM, typ: "admin+jwt" })
    .setSubject("admin")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getKey(secret));
}

/**
 * Sign a long-lived session JWT.
 *
 * Called by the token-exchange endpoint (`/auth/accept`) after verifying the
 * invite token. The session token is stored as an httpOnly cookie.
 */
export async function signSessionToken(secret: string): Promise<string> {
  return new SignJWT({ scope: "chat" } satisfies Pick<TokenPayload, "scope">)
    .setProtectedHeader({ alg: ALGORITHM, typ: "session+jwt" })
    .setSubject("session")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getKey(secret));
}
