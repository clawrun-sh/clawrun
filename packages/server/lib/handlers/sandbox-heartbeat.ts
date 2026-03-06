import { NextResponse } from "next/server";
import { requireSandboxAuth } from "@clawrun/auth";
import { SandboxLifecycleManager } from "@clawrun/runtime";
import type { ExtendPayload } from "@clawrun/runtime";
import { sandboxId as toSandboxId } from "@clawrun/provider";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:sandbox-hb");

/**
 * Sandbox heartbeat endpoint — called by the sandbox's internal reporter loop.
 *
 * Every 60s, a background script inside the sandbox POST's here with
 * filesystem mtime data. The lifecycle manager queries cron info
 * server-side and decides whether to extend the timeout or snapshot+stop.
 */
export async function POST(req: Request) {
  const denied = requireSandboxAuth(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ action: "error", error: "Invalid JSON" }, { status: 400 });
  }

  const { sandboxId, lastChangedAt, root } = body;
  if (!sandboxId || typeof sandboxId !== "string") {
    return NextResponse.json({ action: "error", error: "Missing sandboxId" }, { status: 400 });
  }
  if (typeof lastChangedAt !== "number") {
    return NextResponse.json(
      { action: "error", error: "Missing or invalid lastChangedAt" },
      { status: 400 },
    );
  }
  if (!root || typeof root !== "string") {
    return NextResponse.json({ action: "error", error: "Missing root" }, { status: 400 });
  }

  const sandboxCreatedAt =
    typeof body.sandboxCreatedAt === "number" ? body.sandboxCreatedAt : undefined;

  const payload: ExtendPayload = {
    sandboxId: toSandboxId(sandboxId as string),
    lastChangedAt,
    sandboxCreatedAt,
    root,
  };

  try {
    const manager = new SandboxLifecycleManager();
    const result = await manager.handleExtend(payload);
    if (result.action === "error") {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("Extend error:", error);
    return NextResponse.json({ action: "error", error }, { status: 500 });
  }
}
