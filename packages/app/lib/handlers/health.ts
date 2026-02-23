export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { SandboxLifecycleManager } from "../sandbox/lifecycle";

export async function GET() {
  const response: Record<string, unknown> = {
    status: "ok",
    agent: "zeroclaw",
    version: "0.1.0",
  };

  try {
    const manager = new SandboxLifecycleManager();
    const sandboxStatus = await manager.getStatus();
    // Expose running state + status publicly — no sandbox IDs or timestamps
    response.sandbox = { running: sandboxStatus.running, status: sandboxStatus.status };
  } catch {
    response.sandbox = { running: false };
  }

  return NextResponse.json(response);
}
