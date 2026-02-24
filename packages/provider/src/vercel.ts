import { Sandbox, Snapshot } from "@vercel/sandbox";
import type {
  SandboxProvider,
  ManagedSandbox,
  SandboxInfo,
  SnapshotInfo,
  CreateSandboxOptions,
  RunCommandOptions,
  CommandResult,
  SnapshotRef,
} from "./types";

class VercelManagedSandbox implements ManagedSandbox {
  constructor(private sandbox: Sandbox) {}

  get id(): string {
    return this.sandbox.sandboxId;
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
    return { id: snap.snapshotId };
  }

  extendTimeout(ms: number): Promise<void> {
    return this.sandbox.extendTimeout(ms);
  }
}

export class VercelSandboxProvider implements SandboxProvider {
  async create(opts: CreateSandboxOptions): Promise<ManagedSandbox> {
    const createOpts: Record<string, unknown> = { timeout: opts.timeout };
    if (opts.ports) createOpts.ports = opts.ports;
    if (opts.snapshotId) {
      createOpts.source = { type: "snapshot", snapshotId: opts.snapshotId };
    }
    const sandbox = await Sandbox.create(createOpts);
    return new VercelManagedSandbox(sandbox);
  }

  async get(id: string): Promise<ManagedSandbox> {
    const sandbox = await Sandbox.get({ sandboxId: id });
    return new VercelManagedSandbox(sandbox);
  }

  async list(): Promise<SandboxInfo[]> {
    const result = await Sandbox.list();
    return result.json.sandboxes;
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const result = await Snapshot.list();
    return result.json.snapshots.map((s: Record<string, unknown>) => ({
      id: (s.snapshotId ?? s.id) as string,
      createdAt: (s.createdAt as number) ?? Date.now(),
      sandboxId: s.sourceSandboxId as string | undefined,
    }));
  }

  async deleteSnapshot(id: string): Promise<void> {
    try {
      const snapshot = await Snapshot.get({ snapshotId: id });
      await snapshot.delete();
    } catch (err) {
      // Snapshot already expired or deleted — treat as success
      const text = (err as { text?: string }).text ?? "";
      if (text.includes("expired or deleted")) return;
      throw err;
    }
  }
}
