export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { SandboxLifecycleManager } from "../sandbox/lifecycle";

/**
 * Sandbox extend endpoint — called by the sandbox's internal extend loop.
 *
 * Every 60s, a background script inside the sandbox POST's here with its
 * sandbox ID. The lifecycle manager decides whether to extend the timeout
 * (keep alive) or snapshot+stop (idle).
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

  let body: { sandboxId?: string };
  try {
    body = (await req.json()) as { sandboxId?: string };
  } catch {
    return NextResponse.json({ action: "error", error: "Invalid JSON" }, { status: 400 });
  }

  const { sandboxId } = body;
  if (!sandboxId) {
    return NextResponse.json({ action: "error", error: "Missing sandboxId" }, { status: 400 });
  }

  try {
    const manager = new SandboxLifecycleManager();
    const result = await manager.handleExtend(sandboxId);
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[CloudClaw] Extend error:", error);
    return NextResponse.json({ action: "error", error }, { status: 500 });
  }
}
