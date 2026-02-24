export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireBearerAuth, SandboxLifecycleManager } from "@cloudclaw/runtime";
import { createLogger } from "@cloudclaw/logger";

const log = createLogger("handler:restart");

export async function POST(req: Request) {
  const denied = requireBearerAuth(req);
  if (denied) return denied;

  try {
    const manager = new SandboxLifecycleManager();
    const result = await manager.forceRestart();
    if (result.status === "failed") {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("Restart error:", error);
    return NextResponse.json({ status: "error", error }, { status: 500 });
  }
}
