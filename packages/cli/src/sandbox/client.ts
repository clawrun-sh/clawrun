import { execa } from "execa";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { SandboxProvider, ManagedSandbox } from "@clawrun/provider";
import type { PlatformProvider } from "../platform/types.js";
import type { SandboxClient, SandboxEntry, ExecResult } from "./types.js";

/** Resolve the `sandbox` CLI binary from our own node_modules. */
function sandboxBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("sandbox/package.json");
  return join(dirname(pkgPath), "bin", "sandbox.mjs");
}

/**
 * SandboxClient backed by a SandboxProvider.
 *
 * All SDK operations go through the provider. The CLI binary is only
 * used for `connect` (interactive shell).
 */
export class ProviderSandboxClient implements SandboxClient {
  private sandboxCache = new Map<string, ManagedSandbox>();

  constructor(
    private provider: SandboxProvider,
    private deployDir: string,
    private platform: PlatformProvider,
  ) {}

  private async getSandbox(id: string): Promise<ManagedSandbox> {
    let sandbox = this.sandboxCache.get(id);
    if (!sandbox) {
      sandbox = await this.provider.get(id);
      this.sandboxCache.set(id, sandbox);
    }
    return sandbox;
  }

  async list(): Promise<SandboxEntry[]> {
    const sandboxes = await this.provider.list();
    return sandboxes.map((s) => ({
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
    const snapshots = await this.provider.listSnapshots();
    return snapshots.map((s) => s.id);
  }

  async deleteSnapshots(...snapshotIds: string[]): Promise<void> {
    if (snapshotIds.length === 0) return;
    await Promise.all(snapshotIds.map((id) => this.provider.deleteSnapshot(id)));
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
      return await sandbox.readFile(path);
    } catch {
      return null;
    }
  }

  async connect(sandboxId: string, env?: Record<string, string>): Promise<void> {
    const connectArgs = this.platform.getConnectArgs(this.deployDir, sandboxId);
    const args = [sandboxBin(), "connect", ...connectArgs];
    if (env) {
      for (const [k, v] of Object.entries(env)) {
        args.push("-e", `${k}=${v}`);
      }
    }
    await execa("node", args, { stdio: "inherit" });
  }
}
