import type { ProviderId } from "./types.js";

export type PlatformTier = "hobby" | "paid";

export interface PlatformLimits {
  /** Cron expression for the heartbeat job. */
  heartbeatCron: string;
  /** CPU hours per month, or null if unlimited. */
  cpuHoursPerMonth: number | null;
  /** Max concurrent sandboxes. */
  maxConcurrentSandboxes: number;
  /** Days before snapshots expire. */
  snapshotExpirationDays: number;
}

/** Opaque handle to a platform project — platform-specific internals. */
export interface ProjectHandle {
  readonly provider: ProviderId;
  /** Unique project identifier on the platform. */
  readonly projectId: string;
  /** Org/team identifier on the platform. */
  readonly orgId: string;
}

export interface StateStoreEntry {
  id: string;
  name: string;
  status: string;
  product: string;
  installationId: string;
}

export interface StateStoreResult {
  success: boolean;
  /** KV env vars (KV_REST_API_URL, KV_REST_API_TOKEN, etc.). Empty on failure. */
  vars: Record<string, string>;
}

export interface LogsOptions {
  follow?: boolean;
  limit?: number;
  json?: boolean;
  query?: string;
  since?: string;
  level?: string;
}

/**
 * Structured progress event emitted during long-running operations.
 *
 * The generic parameter `S` constrains the `step` field:
 * - Platform methods use `ProgressEvent<PlatformStep>`
 * - Instance manager uses `ProgressEvent<InstanceStep>`
 * - `deploy()` uses `ProgressEvent<DeployStep>` for typed orchestration steps
 */
export interface ProgressEvent<S extends string = string> {
  /** Machine-readable step identifier (kebab-case, e.g. "create-project"). */
  step: S;
  /** Human-readable description (e.g. "Creating Vercel project..."). */
  message: string;
  /** Severity — omit or "info" for normal progress, "warning" for non-fatal issues. */
  level?: "info" | "warning";
  /** Sub-step detail from internal subsystems (e.g. "check-cli" during "check-prerequisites"). */
  detail?: string;
}

/** Callback for receiving structured progress events. */
export type ProgressCallback<S extends string = string> = (event: ProgressEvent<S>) => void;

/** Typed step identifiers emitted by platform provider operations. */
export type PlatformStep =
  | "check-node"
  | "check-cli"
  | "install-cli"
  | "check-auth"
  | "login"
  | "create-project"
  | "connect-state-store"
  | "provision-state-store"
  | "persist-env-vars"
  | "patch-config"
  | "disable-protection"
  | "deploy"
  | "wait-state-store"
  | "pull-state-vars"
  | "install-deps"
  | "write-env";

export interface PlatformProvider {
  readonly id: ProviderId;
  readonly name: string;

  // --- Prerequisites ---
  /** Verify CLI tools, auth, etc. */
  checkPrerequisites(onProgress?: ProgressCallback<PlatformStep>): Promise<void>;

  // --- Tier ---
  /** Detect user's current tier: hobby (free) or paid. */
  detectTier(): Promise<PlatformTier>;
  /** Fetch resource limits for the given tier. */
  getLimits(tier: PlatformTier): Promise<PlatformLimits>;
  /** Return platform-aware default env vars (timeouts, intervals). */
  getDefaults(tier: PlatformTier): Record<string, string>;

  // --- Project lifecycle ---
  /** Return the production URL for a project by name (before deploy). */
  getProjectUrl(name: string): string;
  createProject(name: string, onProgress?: ProgressCallback<PlatformStep>): Promise<ProjectHandle>;
  deleteProject(handle: ProjectHandle): Promise<void>;
  /** Read project link from an instance directory. Returns null if not linked. */
  readProjectLink(dir: string): ProjectHandle | null;
  /** Write project link into an instance directory. */
  writeProjectLink(dir: string, handle: ProjectHandle): void;

  // --- State store ---
  listStateStores(): Promise<StateStoreEntry[]>;
  connectStateStore(
    linkedDir: string,
    store: StateStoreEntry,
    projectId: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<StateStoreResult>;
  provisionStateStore(
    linkedDir: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<StateStoreResult>;

  // --- Env vars ---
  persistEnvVars(
    dir: string,
    vars: Record<string, string>,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<void>;

  // --- Platform config ---
  /** Ensure platform-specific config exists and is up to date (upsert semantics). */
  patchPlatformConfig(
    dir: string,
    limits: PlatformLimits,
    onProgress?: ProgressCallback<PlatformStep>,
  ): void;
  /** Disable deployment protection (platform-specific). No-op if not applicable. */
  disableDeploymentProtection(
    dir: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<void>;

  // --- Sandbox ---
  /** Wildcard domains for sandbox lifecycle (heartbeat, sidecar traffic). */
  getInfraDomains(): string[];

  /** SDK packages the provider needs externalized by Next.js at runtime. */
  getServerExternalPackages(): string[];
  /** Build CLI args for connecting to a sandbox shell. */
  getConnectArgs(dir: string, sandboxId: string): string[];

  // --- Instance setup ---
  /** Install dependencies in a deployed instance directory. */
  installDependencies(dir: string, onProgress?: ProgressCallback<PlatformStep>): Promise<void>;
  /** Write environment variables for local deployment. */
  writeLocalEnv(dir: string, vars: Record<string, string>): void;
  /** Clean build artifacts from a previous deployment. */
  cleanBuildCache(dir: string, cacheDir: string): void;

  // --- Deploy ---
  deploy(
    dir: string,
    envVars: Record<string, string>,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<string>;

  // --- Logs ---
  /** Stream deployment logs to stdout. */
  streamLogs(deploymentUrl: string, dir: string, options?: LogsOptions): Promise<void>;
}
