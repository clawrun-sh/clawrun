import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:agent-memory");

async function getSandboxAndAgent() {
  const manager = new SandboxLifecycleManager();
  const status = await manager.getStatus();
  if (!status.running || !status.sandboxId) return null;

  const config = getRuntimeConfig();
  const provider = getProvider(config.instance.provider);
  const sandbox = await provider.get(status.sandboxId);
  const root = await resolveRoot(sandbox);
  const agent = getAgent();
  return { sandbox, root, agent };
}

export async function handleListMemories(req: Request) {
  try {
    const ctx = await getSandboxAndAgent();
    if (!ctx) return Response.json({ error: "Sandbox offline" }, { status: 503 });

    const url = new URL(req.url);
    const query = url.searchParams.get("query") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;

    const entries = await ctx.agent.listMemories(
      ctx.sandbox,
      ctx.root,
      { query, category },
      { signal: AbortSignal.timeout(10_000) },
    );

    return Response.json({ entries });
  } catch (err) {
    log.error("[agent-memory] list error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function handleCreateMemory(req: Request) {
  try {
    const ctx = await getSandboxAndAgent();
    if (!ctx) return Response.json({ error: "Sandbox offline" }, { status: 503 });

    const body = await req.json();
    await ctx.agent.createMemory(
      ctx.sandbox,
      ctx.root,
      { key: body.key, content: body.content, category: body.category },
      { signal: AbortSignal.timeout(10_000) },
    );

    return Response.json({ ok: true });
  } catch (err) {
    log.error("[agent-memory] create error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function handleDeleteMemory(_req: Request, key: string) {
  try {
    const ctx = await getSandboxAndAgent();
    if (!ctx) return Response.json({ error: "Sandbox offline" }, { status: 503 });

    await ctx.agent.deleteMemory(ctx.sandbox, ctx.root, key, {
      signal: AbortSignal.timeout(10_000),
    });

    return Response.json({ ok: true });
  } catch (err) {
    log.error("[agent-memory] delete error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
