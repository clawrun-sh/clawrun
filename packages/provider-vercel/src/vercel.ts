import { Sandbox, Snapshot } from "@vercel/sandbox";
// SDK's own auth utility — reads the Vercel CLI token without us reimplementing it.
import { getAuth } from "@vercel/sandbox/dist/auth/file.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  sandboxId,
  snapshotId,
  type SandboxProvider,
  type ManagedSandbox,
  type SandboxId,
  type SnapshotId,
  type SandboxInfo,
  type SnapshotInfo,
  type CreateSandboxOptions,
  type RunCommandOptions,
  type CommandResult,
  type SnapshotRef,
  type NetworkPolicy,
  type ProviderOptions,
} from "@clawrun/provider";

class VercelManagedSandbox implements ManagedSandbox {
  constructor(private sandbox: Sandbox) {}

  get id(): SandboxId {
    return sandboxId(this.sandbox.sandboxId);
  }

  get status(): string {
    return this.sandbox.status as string;
  }

  get timeout(): number {
    return this.sandbox.timeout;
  }

  get createdAt(): number {
    return this.sandbox.createdAt.getTime();
  }

  async updateNetworkPolicy(policy: NetworkPolicy): Promise<void> {
    await this.sandbox.updateNetworkPolicy(policy);
  }

  runCommand(cmdOrOpts: string | RunCommandOptions, args?: string[]): Promise<CommandResult> {
    if (typeof cmdOrOpts === "string") {
      return this.sandbox.runCommand(cmdOrOpts, args);
    }
    return this.sandbox.runCommand(cmdOrOpts);
  }

  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void> {
    return this.sandbox.writeFiles(files);
  }

  async readFile(path: string): Promise<Buffer | null> {
    try {
      return await this.sandbox.readFileToBuffer({ path });
    } catch {
      return null;
    }
  }

  async stop(): Promise<void> {
    await this.sandbox.stop();
  }

  async snapshot(): Promise<SnapshotRef> {
    const snap = await this.sandbox.snapshot();
    return { id: snapshotId(snap.snapshotId) };
  }

  extendTimeout(ms: number): Promise<void> {
    return this.sandbox.extendTimeout(ms);
  }

  domain(port: number): string {
    return this.sandbox.domain(port);
  }
}

/**
 * Full credentials the Vercel SDK requires — all three fields or none.
 * Passing 1–2 of 3 causes the SDK to throw.
 */
interface SdkCredentials {
  token: string;
  projectId: string;
  teamId: string;
}

/**
 * Resolve full SDK credentials for a Vercel-linked project directory.
 *
 * Reads projectId + orgId from `.vercel/project.json` (project config),
 * and uses the SDK's own `getAuth()` for the token — no manual token
 * parsing or credential reimplementation.
 */
function resolveCredentials(projectDir: string): SdkCredentials | undefined {
  try {
    const data = JSON.parse(readFileSync(join(projectDir, ".vercel", "project.json"), "utf-8")) as {
      projectId?: string;
      orgId?: string;
    };

    if (!data.projectId || !data.orgId) return undefined;

    // Delegate token resolution to the SDK's own getAuth()
    const auth = getAuth();
    if (!auth?.token) return undefined;

    return { token: auth.token, projectId: data.projectId, teamId: data.orgId };
  } catch {
    return undefined;
  }
}

export class VercelSandboxProvider implements SandboxProvider {
  private credentials?: SdkCredentials;
  private projectDir?: string;

  constructor(options?: ProviderOptions) {
    this.projectDir = options?.projectDir;
    if (options?.projectDir) {
      this.credentials = resolveCredentials(options.projectDir);
    }
  }

  /**
   * Fallback: chdir to the project directory for SDK calls when explicit
   * credentials could not be resolved (e.g. missing auth.json).
   */
  private async withScope<T>(fn: () => Promise<T>): Promise<T> {
    if (this.credentials || !this.projectDir) return fn();
    const origCwd = process.cwd();
    process.chdir(this.projectDir);
    try {
      return await fn();
    } finally {
      process.chdir(origCwd);
    }
  }

  async create(opts: CreateSandboxOptions): Promise<ManagedSandbox> {
    const createOpts: Record<string, unknown> = {
      timeout: opts.timeout,
      ...this.credentials,
    };
    if (opts.ports) createOpts.ports = opts.ports;
    if (opts.resources) createOpts.resources = opts.resources;
    if (opts.networkPolicy) createOpts.networkPolicy = opts.networkPolicy;
    if (opts.snapshotId) {
      createOpts.source = { type: "snapshot", snapshotId: opts.snapshotId };
    }
    const sandbox = await this.withScope(() => Sandbox.create(createOpts));
    return new VercelManagedSandbox(sandbox);
  }

  async get(id: SandboxId): Promise<ManagedSandbox> {
    const sandbox = await this.withScope(() => Sandbox.get({ sandboxId: id, ...this.credentials }));
    return new VercelManagedSandbox(sandbox);
  }

  async list(): Promise<SandboxInfo[]> {
    const result = await this.withScope(() => Sandbox.list(this.credentials));
    return result.json.sandboxes.map((s: Record<string, unknown>) => ({
      ...s,
      id: sandboxId(s.id as string),
      sourceSnapshotId: s.sourceSnapshotId ? snapshotId(s.sourceSnapshotId as string) : undefined,
    })) as SandboxInfo[];
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const result = await this.withScope(() => Snapshot.list(this.credentials));
    return result.json.snapshots.map((s: Record<string, unknown>) => ({
      id: snapshotId((s.snapshotId ?? s.id) as string),
      createdAt: (s.createdAt as number) ?? Date.now(),
      sandboxId: s.sourceSandboxId ? sandboxId(s.sourceSandboxId as string) : undefined,
    }));
  }

  async deleteSnapshot(id: SnapshotId): Promise<void> {
    try {
      const snapshot = await this.withScope(() =>
        Snapshot.get({ snapshotId: id, ...this.credentials }),
      );
      await snapshot.delete();
    } catch (err) {
      // Snapshot already expired or deleted — treat as success
      const text = (err as { text?: string }).text ?? "";
      if (text.includes("expired or deleted")) return;
      throw err;
    }
  }
}
