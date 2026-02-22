export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { SandboxLifecycleManager } from "../sandbox/lifecycle";

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? process.env.CLOUDCLAW_CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    const manager = new SandboxLifecycleManager();
    const result = await manager.gracefulStop();
    if (result.status === "failed") {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[CloudClaw] Stop error:", error);
    return NextResponse.json(
      { status: "error", error },
      { status: 500 },
    );
  }
}
