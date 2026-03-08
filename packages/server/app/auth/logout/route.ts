import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@clawrun/auth";

/**
 * Logout endpoint.
 *
 * GET /auth/logout
 *   → Delete the session cookie
 *   → 302 → /auth/expired
 */
export async function GET(req: NextRequest) {
  const response = NextResponse.redirect(new URL("/auth/expired", req.url));

  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.CLAWRUN_INSECURE_COOKIES !== "true",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
