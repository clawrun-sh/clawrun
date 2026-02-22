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
    // Only expose running state publicly — no sandbox IDs or timestamps
    response.sandbox = { running: sandboxStatus.running };
  } catch {
    response.sandbox = { running: false };
  }

  return NextResponse.json(response);
}
