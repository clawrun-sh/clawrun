import { SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:agent-events");

export async function handleEvents(req: Request) {
  try {
    const manager = new SandboxLifecycleManager();
    const status = await manager.getStatus();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial status event
        const statusEvent = {
          type: "status",
          data: {
            running: status.running,
            sandboxId: status.sandboxId ?? null,
            status: status.status ?? "unknown",
          },
          timestamp: new Date().toISOString(),
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(statusEvent)}\n\n`),
        );

        // Heartbeat every 30s to keep connection alive
        const interval = setInterval(() => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() })}\n\n`),
            );
          } catch {
            clearInterval(interval);
          }
        }, 30_000);

        // Clean up on abort
        req.signal.addEventListener("abort", () => {
          clearInterval(interval);
          try {
            controller.close();
          } catch {}
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    log.error("[agent-events] error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
