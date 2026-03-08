import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:agent-cron");

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

export async function handleListCronJobs() {
  try {
    const ctx = await getSandboxAndAgent();
    if (!ctx) return Response.json({ error: "Sandbox offline" }, { status: 503 });

    const jobs = await ctx.agent.listCronJobs(ctx.sandbox, ctx.root, {
      signal: AbortSignal.timeout(10_000),
    });

    return Response.json({ jobs });
  } catch (err) {
    log.error("[agent-cron] list error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function handleCreateCronJob(req: Request) {
  try {
    const ctx = await getSandboxAndAgent();
    if (!ctx) return Response.json({ error: "Sandbox offline" }, { status: 503 });

    const body = await req.json();
    const job = await ctx.agent.createCronJob(
      ctx.sandbox,
      ctx.root,
      { name: body.name, schedule: body.schedule, command: body.command },
      { signal: AbortSignal.timeout(10_000) },
    );

    return Response.json(job);
  } catch (err) {
    log.error("[agent-cron] create error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function handleDeleteCronJob(_req: Request, id: string) {
  try {
    const ctx = await getSandboxAndAgent();
    if (!ctx) return Response.json({ error: "Sandbox offline" }, { status: 503 });

    await ctx.agent.deleteCronJob(ctx.sandbox, ctx.root, id, {
      signal: AbortSignal.timeout(10_000),
    });

    return Response.json({ ok: true });
  } catch (err) {
    log.error("[agent-cron] delete error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
