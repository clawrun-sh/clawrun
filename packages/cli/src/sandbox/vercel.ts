import { execa } from "execa";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { SandboxClient, SandboxEntry, ExecResult } from "./types.js";

/** Resolve the `sandbox` CLI binary from our own node_modules. */
function sandboxBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("sandbox/package.json");
  return join(dirname(pkgPath), "bin", "sandbox.mjs");
}

/**
 * SandboxClient backed by the Vercel `sandbox` CLI.
 */
export class VercelSandboxClient implements SandboxClient {
  private projectId: string;
  private orgId: string;

  constructor(opts: { projectId: string; orgId: string }) {
    this.projectId = opts.projectId;
    this.orgId = opts.orgId;
  }

  private scopeArgs(): string[] {
    return ["--project", this.projectId, "--scope", this.orgId];
  }

  async list(): Promise<SandboxEntry[]> {
    const { stdout } = await execa("node", [
      sandboxBin(), "list", ...this.scopeArgs(),
    ]);

    const entries: SandboxEntry[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("sbx_")) continue;
      const parts = line.split(/\s{2,}/);
      entries.push({ id: parts[0], status: parts[1] ?? "unknown" });
    }
    return entries;
  }

  async exec(
    sandboxId: string,
    cmd: string,
    args: string[],
    env?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<ExecResult> {
    const execArgs = [
      sandboxBin(), "exec", sandboxId,
      ...this.scopeArgs(),
    ];

    if (env) {
      for (const [k, v] of Object.entries(env)) {
        execArgs.push("-e", `${k}=${v}`);
      }
    }

    execArgs.push("--", cmd, ...args);

    try {
      const result = await execa("node", execArgs, { timeout: options?.timeoutMs ?? 60_000 });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
      let stderr = e.stderr ?? "";

      // The sandbox CLI wraps API errors in a verbose stack trace.
      // Try to extract the concise message from the JSON payload.
      const jsonMatch = stderr.match(/"message"\s*:\s*"([^"]+)"/);
      if (jsonMatch) {
        stderr = jsonMatch[1];
      }

      return {
        exitCode: e.exitCode ?? 1,
        stdout: e.stdout ?? "",
        stderr,
      };
    }
  }

  async readFile(sandboxId: string, path: string): Promise<Buffer | null> {
    try {
      const result = await this.exec(
        sandboxId,
        "sh",
        ["-c", `base64 < "${path}" 2>/dev/null`],
      );
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return null;
      }
      return Buffer.from(result.stdout.trim(), "base64");
    } catch {
      return null;
    }
  }

  async connect(sandboxId: string, env?: Record<string, string>): Promise<void> {
    const args = [sandboxBin(), "connect", sandboxId, ...this.scopeArgs()];
    if (env) {
      for (const [k, v] of Object.entries(env)) {
        args.push("-e", `${k}=${v}`);
      }
    }
    await execa("node", args, { stdio: "inherit" });
  }
}
