// --- Provider ID ---

export const PROVIDER_IDS = ["vercel"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

// --- Branded ID types ---

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type SandboxId = Brand<string, "SandboxId">;
export type SnapshotId = Brand<string, "SnapshotId">;

export function sandboxId(id: string): SandboxId {
  return id as SandboxId;
}
export function snapshotId(id: string): SnapshotId {
  return id as SnapshotId;
}

// --- Provider options ---

export interface ProviderOptions {
  /** Directory containing platform-specific project configuration for auth and scoping. */
  projectDir?: string;
}

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
  readonly id: SandboxId;
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
  readonly id: SnapshotId;
}

// --- Sandbox listing info ---

export interface SandboxInfo {
  id: SandboxId;
  status: string;
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
  timeout: number;
  memory: number;
  vcpus: number;
  sourceSnapshotId?: SnapshotId;
}

// --- Snapshot listing info ---

export interface SnapshotInfo {
  id: SnapshotId;
  createdAt: number;
  sandboxId?: SandboxId;
}

// --- Provider ---

export interface CreateSandboxOptions {
  timeout: number;
  ports?: number[];
  snapshotId?: SnapshotId;
  resources?: { vcpus: number };
  networkPolicy?: NetworkPolicy;
}

export interface SandboxProvider {
  create(opts: CreateSandboxOptions): Promise<ManagedSandbox>;
  get(id: SandboxId): Promise<ManagedSandbox>;
  list(): Promise<SandboxInfo[]>;

  listSnapshots(): Promise<SnapshotInfo[]>;
  deleteSnapshot(id: SnapshotId): Promise<void>;
}
