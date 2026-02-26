import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@clawrun/auth";
import { verifySessionCookie } from "./session.js";

/**
 * Middleware that protects the /chat page.
 *
 * Verifies the session cookie via the shared `verifySessionCookie` helper.
 * If missing or expired, redirects to /auth/expired.
 * All API routes and other pages are left unaffected.
 */
export default async function proxy(req: NextRequest) {
  const secret = process.env.CLAWRUN_JWT_SECRET;

  if (!secret) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const payload = await verifySessionCookie(cookieHeader, secret);

  if (!payload) {
    const response = NextResponse.redirect(new URL("/auth/expired", req.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/chat"],
};
