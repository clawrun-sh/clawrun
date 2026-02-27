// --- Network policy ---

export type NetworkPolicy =
  | "allow-all"
  | "deny-all"
  | {
      allow?: string[];
      subnets?: {
        allow?: string[];
        deny?: string[];
      };
    };

// --- Command execution ---

export interface RunCommandOptions {
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
  detached?: boolean;
  signal?: AbortSignal;
}

export interface CommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

// --- Sandbox instance ---

export interface ManagedSandbox {
  readonly id: string;
  readonly status: string;
  /** Current timeout in ms (includes extensions). */
  readonly timeout: number;
  /** Epoch ms when sandbox was created. */
  readonly createdAt: number;

  runCommand(cmd: string, args?: string[]): Promise<CommandResult>;
  runCommand(opts: RunCommandOptions): Promise<CommandResult>;

  updateNetworkPolicy(policy: NetworkPolicy): Promise<void>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  readFile(path: string): Promise<Buffer | null>;
  stop(): Promise<void>;
  snapshot(): Promise<SnapshotRef>;
  extendTimeout(ms: number): Promise<void>;
  domain(port: number): string;
}

export interface SnapshotRef {
  readonly id: string;
}

// --- Sandbox listing info ---

export interface SandboxInfo {
  id: string;
  status: string;
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
  timeout: number;
  sourceSnapshotId?: string;
}

// --- Snapshot listing info ---

export interface SnapshotInfo {
  id: string;
  createdAt: number;
  sandboxId?: string;
}

// --- Provider ---

export interface CreateSandboxOptions {
  timeout: number;
  ports?: number[];
  snapshotId?: string;
  resources?: { vcpus: number };
  networkPolicy?: NetworkPolicy;
}

export interface SandboxProvider {
  create(opts: CreateSandboxOptions): Promise<ManagedSandbox>;
  get(id: string): Promise<ManagedSandbox>;
  list(): Promise<SandboxInfo[]>;

  listSnapshots(): Promise<SnapshotInfo[]>;
  deleteSnapshot(id: string): Promise<void>;
}
