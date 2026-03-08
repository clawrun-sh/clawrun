import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:agent-config");

export async function handleGetConfig() {
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
    const agentConfig = await agent.getConfig(sandbox, root, {
      signal: AbortSignal.timeout(10_000),
    });

    return Response.json(agentConfig);
  } catch (err) {
    log.error("[agent-config] GET error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
