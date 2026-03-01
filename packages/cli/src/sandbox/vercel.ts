import { Sandbox, Snapshot } from "@vercel/sandbox";
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { SandboxClient, SandboxEntry, ExecResult } from "./types.js";

// ---------------------------------------------------------------------------
// CLI binary helper (only used for `connect`)
// ---------------------------------------------------------------------------

/** Resolve the `sandbox` CLI binary from our own node_modules. */
function sandboxBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("sandbox/package.json");
  return join(dirname(pkgPath), "bin", "sandbox.mjs");
}

// ---------------------------------------------------------------------------
// VercelSandboxClient — backed by @vercel/sandbox SDK
// ---------------------------------------------------------------------------

/**
 * SandboxClient backed by the `@vercel/sandbox` SDK.
 *
 * Authentication and project scoping are handled entirely by the SDK.
 * The client temporarily sets `process.cwd()` to the instance's deploy
 * directory (which contains `.vercel/project.json`) so the SDK can
 * discover the linked project and resolve credentials automatically.
 *
 * Uses the CLI binary only for `connect` (interactive shell).
 */
export class VercelSandboxClient implements SandboxClient {
  /** Instance deploy directory containing `.vercel/project.json`. */
  private deployDir: string;
  private sandboxCache = new Map<string, Sandbox>();

  constructor(deployDir: string) {
    this.deployDir = deployDir;
  }

  /**
   * Run an async function with cwd set to the deploy directory so the SDK
   * can discover `.vercel/project.json` for auth + project scoping.
   */
  private async withProjectScope<T>(fn: () => Promise<T>): Promise<T> {
    const origCwd = process.cwd();
    process.chdir(this.deployDir);
    try {
      return await fn();
    } finally {
      process.chdir(origCwd);
    }
  }

  private async getSandbox(id: string): Promise<Sandbox> {
    let sandbox = this.sandboxCache.get(id);
    if (!sandbox) {
      sandbox = await this.withProjectScope(() => Sandbox.get({ sandboxId: id }));
      this.sandboxCache.set(id, sandbox);
    }
    return sandbox;
  }

  /** Read projectId and orgId from `.vercel/project.json` (for CLI binary). */
  private readProjectLink(): { projectId: string; orgId: string } {
    const data = JSON.parse(
      readFileSync(join(this.deployDir, ".vercel", "project.json"), "utf-8"),
    ) as { projectId: string; orgId: string };
    return data;
  }

  async list(): Promise<SandboxEntry[]> {
    const result = await this.withProjectScope(() => Sandbox.list());
    return result.json.sandboxes.map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      memory: s.memory,
      vcpus: s.vcpus,
    }));
  }

  async stop(...sandboxIds: string[]): Promise<void> {
    if (sandboxIds.length === 0) return;
    await Promise.all(
      sandboxIds.map(async (id) => {
        const sandbox = await this.getSandbox(id);
        await sandbox.stop();
      }),
    );
  }

  async listSnapshots(): Promise<string[]> {
    const result = await this.withProjectScope(() => Snapshot.list());
    return result.json.snapshots.map((s) => s.id);
  }

  async deleteSnapshots(...snapshotIds: string[]): Promise<void> {
    if (snapshotIds.length === 0) return;
    await Promise.all(
      snapshotIds.map(async (id) => {
        try {
          const snapshot = await this.withProjectScope(() => Snapshot.get({ snapshotId: id }));
          await snapshot.delete();
        } catch {
          // Already expired or deleted — treat as success
        }
      }),
    );
  }

  async exec(
    sandboxId: string,
    cmd: string,
    args: string[],
    env?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<ExecResult> {
    const sandbox = await this.getSandbox(sandboxId);
    try {
      const timeoutMs = options?.timeoutMs ?? 60_000;
      const result = await sandbox.runCommand({
        cmd,
        args,
        env,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return {
        exitCode: result.exitCode,
        stdout: await result.stdout(),
        stderr: await result.stderr(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: "", stderr: msg };
    }
  }

  async readFile(sandboxId: string, path: string): Promise<Buffer | null> {
    try {
      const sandbox = await this.getSandbox(sandboxId);
      return await sandbox.readFileToBuffer({ path });
    } catch {
      return null;
    }
  }

  async connect(sandboxId: string, env?: Record<string, string>): Promise<void> {
    const { projectId, orgId } = this.readProjectLink();
    const args = [sandboxBin(), "connect", sandboxId, "--project", projectId, "--scope", orgId];
    if (env) {
      for (const [k, v] of Object.entries(env)) {
        args.push("-e", `${k}=${v}`);
      }
    }
    await execa("node", args, { stdio: "inherit" });
  }
}
