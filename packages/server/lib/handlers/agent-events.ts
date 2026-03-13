import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:agent-events");

export async function handleEvents(req: Request) {
  try {
    const manager = new SandboxLifecycleManager();
    const config = getRuntimeConfig();
    const provider = getProvider(config.instance.provider);
    const agent = getAgent();

    let cachedSandboxId: unknown;
    let sandbox: Awaited<ReturnType<typeof provider.get>> | undefined;
    let root: string | undefined;

    async function resolveSandbox(sandboxId: Parameters<typeof provider.get>[0]) {
      if (sandboxId !== cachedSandboxId) {
        sandbox = await provider.get(sandboxId);
        root = await resolveRoot(sandbox);
        cachedSandboxId = sandboxId;
      }
    }

    let isFetching = false;

    async function fetchSnapshot(): Promise<string> {
      const health: Record<string, unknown> = {
        status: "ok",
        agent: config.agent.name,
        provider: config.instance.provider,
      };

      let statusData: unknown = null;
      let costData: unknown = null;

      try {
        const sbStatus = await manager.getStatus();
        health.sandbox = { running: sbStatus.running, status: sbStatus.status };

        if (sbStatus.running && sbStatus.sandboxId) {
          await resolveSandbox(sbStatus.sandboxId);
          const [statusResult, costResult] = await Promise.allSettled([
            agent.getStatus(sandbox!, root!, { signal: AbortSignal.timeout(8_000) }),
            agent.getCostInfo(sandbox!, root!, { signal: AbortSignal.timeout(8_000) }),
          ]);
          statusData = statusResult.status === "fulfilled" ? statusResult.value : null;
          costData = costResult.status === "fulfilled" ? costResult.value : null;
        }
      } catch {
        health.sandbox = { running: false };
      }

      return JSON.stringify({
        health,
        status: statusData,
        cost: costData,
        timestamp: new Date().toISOString(),
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        function send(data: string) {
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {}
        }

        async function fetchAndSend() {
          if (isFetching) return;
          isFetching = true;
          try {
            const snapshot = await fetchSnapshot();
            send(snapshot);
          } catch (err) {
            log.error("[agent-events] fetch error:", err instanceof Error ? err.message : err);
          } finally {
            isFetching = false;
          }
        }

        // Immediate initial push
        fetchAndSend();

        // Data refresh every 15s
        const dataInterval = setInterval(fetchAndSend, 15_000);

        // SSE keepalive every 30s
        const heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {}
        }, 30_000);

        // Cleanup on disconnect
        req.signal.addEventListener("abort", () => {
          clearInterval(dataInterval);
          clearInterval(heartbeatInterval);
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
