import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, signSessionToken, SESSION_COOKIE } from "@clawrun/auth";

/**
 * Token-exchange endpoint.
 *
 * GET /auth/accept?token=<jwt>
 *   → verify JWT signature + expiry
 *   → Set-Cookie: clawrun-session=<jwt>; HttpOnly; Secure; SameSite=Lax
 *   → 302 → /chat
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/auth/expired", req.url));
  }

  const secret = process.env.CLAWRUN_JWT_SECRET;
  if (!secret) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const payload = await verifyToken(token, secret);
  if (!payload || payload.sub !== "invite" || payload.scope !== "invite") {
    return NextResponse.redirect(new URL("/auth/expired", req.url));
  }

  // Sign a fresh session JWT (8h) — decoupled from the short-lived invite token.
  const sessionToken = await signSessionToken(secret);

  const response = NextResponse.redirect(new URL("/chat", req.url));

  // Prevent the invite URL from leaking via Referer header
  response.headers.set("Referrer-Policy", "no-referrer");

  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return response;
}
