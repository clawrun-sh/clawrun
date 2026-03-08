export const ALGORITHM = "HS256";
export const ISSUER = "clawrun";
export const AUDIENCE = "clawrun";
export const DEFAULT_TTL = "10m";
export const SESSION_TTL = "8h";
export const SESSION_COOKIE = "clawrun-session";

/** Maps each subject to its expected typ header (RFC 8725 §3.11). */
export const SUB_TO_TYP: Record<string, string> = {
  invite: "invite+jwt",
  session: "session+jwt",
  user: "user+jwt",
};
