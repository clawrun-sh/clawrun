import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireCronAuth, requireSandboxAuth, SESSION_COOKIE } from "@clawrun/auth";
import { verifySessionCookie, requireSessionOrBearerAuth } from "@/lib/auth/session";

/**
 * Next.js proxy — centralized auth for all routes.
 *
 * Routes are grouped by auth tier:
 *   - Webhooks: skip (adapter-specific HMAC/signature in handler)
 *   - Sandbox heartbeat: sandbox secret
 *   - Heartbeat (cron): cron secret
 *   - All other API routes: user (session cookie or user Bearer)
 *   - Dashboard pages: session cookie (redirect to /auth/expired if missing)
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Webhook routes: skip (adapter-specific auth in handler) ---
  if (pathname.startsWith("/api/v1/webhook/")) {
    return NextResponse.next();
  }

  // --- Sandbox heartbeat: sandbox secret ---
  if (pathname === "/api/v1/sandbox/heartbeat") {
    const denied = requireSandboxAuth(req);
    if (denied) return denied;
    return NextResponse.next();
  }

  // --- Heartbeat (cron): raw CRON_SECRET ---
  if (pathname === "/api/v1/heartbeat") {
    const denied = await requireCronAuth(req);
    if (denied) return denied;
    return NextResponse.next();
  }

  // --- All other API routes: user auth ---
  if (pathname.startsWith("/api/v1/")) {
    const denied = await requireSessionOrBearerAuth(req);
    if (denied) return denied;
    return NextResponse.next();
  }

  // --- Dashboard pages: session cookie ---
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

// Match everything except auth pages, static assets, and public files.
export const config = {
  matcher: [
    "/((?!auth|_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.webmanifest$).*)",
  ],
};
