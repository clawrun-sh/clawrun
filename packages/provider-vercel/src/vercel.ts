import { Sandbox, Snapshot } from "@vercel/sandbox";
import {
  cachedGenerateCredentials as _cachedGenerateCredentials,
  generateCredentials as _generateCredentials,
} from "@vercel/sandbox/dist/utils/dev-credentials.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Suppress the SDK's noisy `[vercel/sandbox]` stderr logs while letting real errors through. */
async function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("[vercel/sandbox]")) return;
    origError.apply(console, args);
  };
  try {
    return await fn();
  } finally {
    console.error = origError;
  }
}

const cachedGenerateCredentials: typeof _cachedGenerateCredentials = (opts) =>
  silenced(() => _cachedGenerateCredentials(opts));
const generateCredentials: typeof _generateCredentials = (opts) =>
  silenced(() => _generateCredentials(opts));
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

/** Project-level IDs read from `.vercel/project.json`. */
interface ProjectScope {
  projectId: string;
  teamId: string;
}

/**
 * Read projectId + orgId from `.vercel/project.json`.
 */
function readProjectScope(projectDir: string): ProjectScope | undefined {
  try {
    const data = JSON.parse(readFileSync(join(projectDir, ".vercel", "project.json"), "utf-8")) as {
      projectId?: string;
      orgId?: string;
    };
    if (!data.projectId || !data.orgId) return undefined;
    return { projectId: data.projectId, teamId: data.orgId };
  } catch {
    return undefined;
  }
}

export class VercelSandboxProvider implements SandboxProvider {
  private scope?: ProjectScope;
  private projectDir?: string;

  constructor(options?: ProviderOptions) {
    this.projectDir = options?.projectDir;
    if (options?.projectDir) {
      this.scope = readProjectScope(options.projectDir);
    }
  }

  /**
   * Resolve credentials via the SDK's `cachedGenerateCredentials`, which
   * handles token refresh (OAuth) and caches per team/project pair.
   */
  private async getCredentials(): Promise<SdkCredentials | undefined> {
    if (!this.scope) return undefined;
    return cachedGenerateCredentials(this.scope);
  }

  /**
   * Force a fresh credential generation, bypassing the cache.
   * Used when the cached token is rejected (401) by the API.
   */
  private async refreshCredentials(): Promise<SdkCredentials | undefined> {
    if (!this.scope) return undefined;
    return generateCredentials(this.scope);
  }

  private static is401(err: unknown): boolean {
    if (typeof err === "object" && err !== null && "status" in err) {
      return (err as { status: number }).status === 401;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("status 401");
  }

  /**
   * Execute an SDK call with credentials. On 401, force-refresh credentials
   * and retry once. Falls back to chdir when no project scope is available.
   */
  private async withScope<T>(fn: (creds?: SdkCredentials) => Promise<T>): Promise<T> {
    const creds = await this.getCredentials();
    if (creds) {
      try {
        return await fn(creds);
      } catch (err) {
        if (VercelSandboxProvider.is401(err)) {
          const freshCreds = await this.refreshCredentials();
          if (freshCreds) return fn(freshCreds);
        }
        throw err;
      }
    }
    if (!this.projectDir) return fn();
    const origCwd = process.cwd();
    process.chdir(this.projectDir);
    try {
      return await fn();
    } finally {
      process.chdir(origCwd);
    }
  }

  async create(opts: CreateSandboxOptions): Promise<ManagedSandbox> {
    const sandbox = await this.withScope((creds) => {
      const createOpts: Record<string, unknown> = {
        timeout: opts.timeout,
        ...creds,
      };
      if (opts.ports) createOpts.ports = opts.ports;
      if (opts.resources) createOpts.resources = opts.resources;
      if (opts.networkPolicy) createOpts.networkPolicy = opts.networkPolicy;
      if (opts.snapshotId) {
        createOpts.source = { type: "snapshot", snapshotId: opts.snapshotId };
      }
      return Sandbox.create(createOpts);
    });
    return new VercelManagedSandbox(sandbox);
  }

  async get(id: SandboxId): Promise<ManagedSandbox> {
    const sandbox = await this.withScope((creds) => Sandbox.get({ sandboxId: id, ...creds }));
    return new VercelManagedSandbox(sandbox);
  }

  async list(): Promise<SandboxInfo[]> {
    const result = await this.withScope((creds) => Sandbox.list(creds));
    return result.json.sandboxes.map((s: Record<string, unknown>) => ({
      ...s,
      id: sandboxId(s.id as string),
      sourceSnapshotId: s.sourceSnapshotId ? snapshotId(s.sourceSnapshotId as string) : undefined,
    })) as SandboxInfo[];
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const result = await this.withScope((creds) => Snapshot.list(creds));
    return result.json.snapshots.map((s: Record<string, unknown>) => ({
      id: snapshotId((s.snapshotId ?? s.id) as string),
      createdAt: (s.createdAt as number) ?? Date.now(),
      sandboxId: s.sourceSandboxId ? sandboxId(s.sourceSandboxId as string) : undefined,
    }));
  }

  async deleteSnapshot(id: SnapshotId): Promise<void> {
    try {
      const snapshot = await this.withScope((creds) => Snapshot.get({ snapshotId: id, ...creds }));
      await snapshot.delete();
    } catch (err) {
      // Snapshot already expired or deleted — treat as success
      const text = (err as { text?: string }).text ?? "";
      if (text.includes("expired or deleted")) return;
      throw err;
    }
  }
}
