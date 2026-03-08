import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:agent-status");

export async function handleGetAgentStatus() {
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
    if (!agent.getAgentStatus) {
      return Response.json({ error: "Not supported" }, { status: 501 });
    }

    const agentStatus = await agent.getAgentStatus(sandbox, root, {
      signal: AbortSignal.timeout(10_000),
    });

    return Response.json(agentStatus);
  } catch (err) {
    log.error("[agent-status] error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
