import { getProvider } from "@clawrun/provider";
import { getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:workspace-files");

async function getSandboxAndRoot() {
  const manager = new SandboxLifecycleManager();
  const status = await manager.getStatus();
  if (!status.running || !status.sandboxId) return null;

  const config = getRuntimeConfig();
  const provider = getProvider(config.instance.provider);
  const sandbox = await provider.get(status.sandboxId);
  const root = await resolveRoot(sandbox);
  return { sandbox, root };
}

export async function handleListWorkspaceFiles() {
  try {
    const ctx = await getSandboxAndRoot();
    if (!ctx) {
      return Response.json({ error: "Sandbox offline" }, { status: 503 });
    }

    const { sandbox, root } = ctx;
    const workspaceDir = `${root}/agent/workspace`;
    const result = await sandbox.runCommand("find", [
      workspaceDir,
      "-maxdepth",
      "1",
      "-name",
      "*.md",
      "-type",
      "f",
    ]);
    const stdout = (await result.stdout()).trim();
    if (!stdout) {
      return Response.json({ files: [] });
    }

    const files = stdout
      .split("\n")
      .filter(Boolean)
      .map((fullPath) => {
        const name = fullPath.split("/").pop()!;
        return { name, path: fullPath };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({ files });
  } catch (err) {
    log.error("[workspace-files] list error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function handleGetWorkspaceFile(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const ctx = await getSandboxAndRoot();
    if (!ctx) {
      return Response.json({ error: "Sandbox offline" }, { status: 503 });
    }

    const { name } = await params;

    // Sanitize: only allow .md files, no path traversal
    if (!name.endsWith(".md") || name.includes("/") || name.includes("..")) {
      return Response.json({ error: "Invalid file name" }, { status: 400 });
    }

    const { sandbox, root } = ctx;
    const filePath = `${root}/agent/workspace/${name}`;
    const buf = await sandbox.readFile(filePath);
    if (!buf) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    return Response.json({ name, content: buf.toString("utf-8") });
  } catch (err) {
    log.error("[workspace-files] read error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
