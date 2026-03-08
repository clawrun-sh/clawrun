import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:agent-tools");

export async function handleListTools() {
  try {
    const manager = new SandboxLifecycleManager();
    const status = await manager.getStatus();
    if (!status.running || !status.sandboxId) {
      return Response.json({ error: "Sandbox offline" }, { status: 503 });
    }

    const config = getRuntimeConfig();
    const provider = getProvider(config.instance.provider);
    const sandbox = await provider.get(status.sandboxId);
    const root = await resolveRoot(sandbox);

    const agent = getAgent();
    if (!agent.listRuntimeTools) {
      return Response.json({ error: "Not supported" }, { status: 501 });
    }

    const result = await agent.listRuntimeTools(sandbox, root, {
      signal: AbortSignal.timeout(10_000),
    });

    return Response.json(result);
  } catch (err) {
    log.error("[agent-tools] error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
