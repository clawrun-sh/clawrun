import type { SandboxProvider, ManagedSandbox, SandboxId, SnapshotId } from "@clawrun/provider";
import type { SandboxEntry, ExecResult } from "./types.js";

/**
 * SDK client for sandbox provider-level operations.
 *
 * Wraps a SandboxProvider to provide a clean API for listing, stopping,
 * executing commands, reading files, and managing snapshots.
 */
export class SandboxClient {
  private sandboxCache = new Map<SandboxId, ManagedSandbox>();

  constructor(private provider: SandboxProvider) {}

  private async getSandbox(id: SandboxId): Promise<ManagedSandbox> {
    let sandbox = this.sandboxCache.get(id);
    if (!sandbox) {
      sandbox = await this.provider.get(id);
      this.sandboxCache.set(id, sandbox);
    }
    return sandbox;
  }

  /** List all sandboxes. */
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

  /** Stop one or more sandboxes. */
  async stop(...sandboxIds: SandboxId[]): Promise<void> {
    if (sandboxIds.length === 0) return;
    await Promise.all(
      sandboxIds.map(async (id) => {
        const sandbox = await this.getSandbox(id);
        await sandbox.stop();
      }),
    );
  }

  /** List snapshot IDs. */
  async listSnapshots(): Promise<SnapshotId[]> {
    const snapshots = await this.provider.listSnapshots();
    return snapshots.map((s) => s.id);
  }

  /** Delete one or more snapshots. */
  async deleteSnapshots(...snapshotIds: SnapshotId[]): Promise<void> {
    if (snapshotIds.length === 0) return;
    await Promise.all(snapshotIds.map((id) => this.provider.deleteSnapshot(id)));
  }

  /** Execute a command inside a running sandbox. */
  async exec(
    sandboxId: SandboxId,
    cmd: string,
    args: string[],
    env?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<ExecResult> {
    const sandbox = await this.getSandbox(sandboxId);
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
  }

  /** Read a file from a running sandbox. Returns null if not found. */
  async readFile(sandboxId: SandboxId, path: string): Promise<Buffer | null> {
    try {
      const sandbox = await this.getSandbox(sandboxId);
      return await sandbox.readFile(path);
    } catch {
      return null;
    }
  }
}
