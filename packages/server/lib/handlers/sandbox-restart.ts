import { NextResponse } from "next/server";
import { requireBearerAuth } from "@clawrun/auth";
import { SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:restart");

export async function POST(req: Request) {
  const denied = await requireBearerAuth(req);
  if (denied) return denied;

  try {
    const manager = new SandboxLifecycleManager();
    const result = await manager.forceRestart();
    if (result.status === "failed") {
      log.error(`Restart failed: ${result.error}`);
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("Restart error:", error);
    return NextResponse.json({ status: "error", error }, { status: 500 });
  }
}
