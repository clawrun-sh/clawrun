export type PlatformTier = "hobby" | "paid";

export interface PlatformLimits {
  /** Max sandbox timeout in milliseconds. */
  maxSandboxTimeoutMs: number;
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
  readonly provider: string;
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

export interface PlatformProvider {
  readonly id: string;
  readonly name: string;

  // --- Prerequisites ---
  /** Verify CLI tools, auth, etc. Prints progress via clack. */
  checkPrerequisites(): Promise<void>;

  // --- Tier ---
  /** Detect user's current tier: hobby (free) or paid. */
  detectTier(): Promise<PlatformTier>;
  /** Fetch resource limits for the given tier. */
  getLimits(tier: PlatformTier): Promise<PlatformLimits>;
  /** Return platform-aware default env vars (timeouts, intervals). */
  getDefaults(tier: PlatformTier): Record<string, string>;

  // --- Project lifecycle ---
  createProject(name: string): Promise<ProjectHandle>;
  deleteProject(handle: ProjectHandle): Promise<void>;
  /** Read project link from an instance directory. Returns null if not linked. */
  readProjectLink(dir: string): ProjectHandle | null;
  /** Write project link into an instance directory. */
  writeProjectLink(dir: string, handle: ProjectHandle): void;

  // --- State store ---
  listStateStores(): Promise<StateStoreEntry[]>;
  connectStateStore(linkedDir: string, store: StateStoreEntry, projectId: string): Promise<StateStoreResult>;
  provisionStateStore(linkedDir: string): Promise<StateStoreResult>;

  // --- Env vars ---
  persistEnvVars(dir: string, vars: Record<string, string>): Promise<void>;

  // --- Platform config ---
  /** Patch platform-specific config (e.g. cron schedules in vercel.json). */
  patchPlatformConfig(dir: string, limits: PlatformLimits): void;
  /** Disable deployment protection (platform-specific). No-op if not applicable. */
  disableDeploymentProtection(dir: string): Promise<void>;

  // --- Deploy ---
  deploy(dir: string, envVars: Record<string, string>): Promise<string>;
}
