import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";
import { requireSessionOrBearerAuth } from "../auth/session";

const log = createLogger("handler:history");

const EMPTY = { messages: [] };

export async function GET(req: Request) {
  const denied = await requireSessionOrBearerAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return Response.json(EMPTY);
  }

  try {
    const manager = new SandboxLifecycleManager();
    const status = await manager.getStatus();
    if (!status.running || !status.sandboxId) {
      log.info(`[history] sandbox not running, returning empty`);
      return Response.json(EMPTY);
    }

    const config = getRuntimeConfig();
    const provider = getProvider(config.instance.provider);
    const sandbox = await provider.get(status.sandboxId);
    const root = await resolveRoot(sandbox);

    const agent = getAgent();
    if (!agent.fetchHistory) {
      return Response.json(EMPTY);
    }

    const messages = await agent.fetchHistory(sandbox, root, sessionId, {
      signal: AbortSignal.timeout(10_000),
    });

    log.info(`[history] sessionId=${sessionId} messages=${messages.length}`);
    return Response.json({ messages });
  } catch (err) {
    log.error(`[history] error:`, err instanceof Error ? err.message : err);
    return Response.json(EMPTY);
  }
}
