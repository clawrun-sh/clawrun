import { getProvider } from "@clawrun/provider";
import { getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";
import type { LogEntry } from "@clawrun/agent";

const log = createLogger("handler:agent-logs");

export async function handleGetLogs(request: Request) {
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

    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200),
      2000,
    );

    const logPath = `${root}/logs/sidecar.log`;
    const buf = await sandbox.readFile(logPath);
    if (!buf) {
      return Response.json({ entries: [] });
    }

    const raw = buf.toString("utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());

    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        entries.push({
          level: obj.level ?? 30,
          time: obj.time ?? 0,
          tag: obj.tag,
          msg: obj.msg ?? "",
        });
      } catch {
        // skip malformed lines
      }
    }

    // Return last N entries
    const sliced = entries.slice(-limit);

    return Response.json({ entries: sliced });
  } catch (err) {
    log.error("[agent-logs] GET error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
