import { NextResponse } from "next/server";
import { SandboxLifecycleManager, getRuntimeConfig } from "@clawrun/runtime";

export async function GET() {
  const config = getRuntimeConfig();
  const response: Record<string, unknown> = {
    status: "ok",
    agent: config.agent.name,
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
