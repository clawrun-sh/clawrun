import { NextResponse } from "next/server";
import { SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:stop");

export async function POST() {
  try {
    const manager = new SandboxLifecycleManager();
    const result = await manager.gracefulStop();
    if (result.status === "failed") {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("Stop error:", error);
    return NextResponse.json({ status: "error", error }, { status: 500 });
  }
}
