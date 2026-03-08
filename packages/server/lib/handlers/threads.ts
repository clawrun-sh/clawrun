import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:threads");

/**
 * GET /api/v1/threads — list all conversation threads across all channels.
 */
export async function handleListThreads() {
  try {
    const manager = new SandboxLifecycleManager();
    const status = await manager.getStatus();
    if (!status.running || !status.sandboxId) {
      return Response.json({ threads: [] });
    }

    const config = getRuntimeConfig();
    const provider = getProvider(config.instance.provider);
    const sandbox = await provider.get(status.sandboxId);
    const root = await resolveRoot(sandbox);

    const agent = getAgent();
    const threads = await agent.listThreads(sandbox, root, {
      signal: AbortSignal.timeout(10_000),
    });

    log.info(`[threads] listed ${threads.length} threads`);
    return Response.json({ threads });
  } catch (err) {
    log.error(`[threads] list error:`, err instanceof Error ? err.message : err);
    return Response.json({ threads: [] });
  }
}

/**
 * GET /api/v1/threads/:threadId — get messages for a specific thread.
 */
export async function handleGetThread(_req: Request, threadId: string) {
  if (!threadId.trim()) {
    return Response.json({ messages: [] });
  }

  try {
    const manager = new SandboxLifecycleManager();
    const status = await manager.getStatus();
    if (!status.running || !status.sandboxId) {
      return Response.json({ messages: [] });
    }

    const config = getRuntimeConfig();
    const provider = getProvider(config.instance.provider);
    const sandbox = await provider.get(status.sandboxId);
    const root = await resolveRoot(sandbox);

    const agent = getAgent();
    const messages = await agent.getThread(sandbox, root, threadId, {
      signal: AbortSignal.timeout(10_000),
    });

    log.info(`[threads] get threadId=${threadId} messages=${messages.length}`);
    return Response.json({ messages });
  } catch (err) {
    log.error(`[threads] get error:`, err instanceof Error ? err.message : err);
    return Response.json({ messages: [] });
  }
}
