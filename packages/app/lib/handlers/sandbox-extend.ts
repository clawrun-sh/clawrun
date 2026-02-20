export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { SandboxLifecycleManager } from "../sandbox/lifecycle";
import type { ExtendPayload } from "../sandbox/lifecycle";

/**
 * Sandbox extend endpoint — called by the sandbox's internal reporter loop.
 *
 * Every 60s, a background script inside the sandbox POST's here with
 * filesystem mtime data and next cron schedule. The lifecycle manager
 * decides whether to extend the timeout or snapshot+stop.
 */
export async function POST(req: Request) {
  // Verify cron secret (same auth as heartbeat)
  const cronSecret = process.env.CRON_SECRET ?? process.env.CLOUDCLAW_CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ action: "error", error: "Invalid JSON" }, { status: 400 });
  }

  const { sandboxId, lastChangedAt, nextCronAt } = body;
  if (!sandboxId || typeof sandboxId !== "string") {
    return NextResponse.json({ action: "error", error: "Missing sandboxId" }, { status: 400 });
  }
  if (typeof lastChangedAt !== "number") {
    return NextResponse.json({ action: "error", error: "Missing or invalid lastChangedAt" }, { status: 400 });
  }

  const cronJobCount = typeof body.cronJobCount === "number" ? body.cronJobCount : undefined;
  const sandboxCreatedAt = typeof body.sandboxCreatedAt === "number" ? body.sandboxCreatedAt : undefined;

  const payload: ExtendPayload = {
    sandboxId,
    lastChangedAt,
    nextCronAt: typeof nextCronAt === "string" ? nextCronAt : null,
    cronJobCount,
    sandboxCreatedAt,
  };

  try {
    const manager = new SandboxLifecycleManager();
    const result = await manager.handleExtend(payload);
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[CloudClaw] Extend error:", error);
    return NextResponse.json({ action: "error", error }, { status: 500 });
  }
}
