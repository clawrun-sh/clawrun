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

export interface PlatformProvider {
  readonly id: string;
  readonly name: string;

  /** Detect user's current tier: hobby (free) or paid. */
  detectTier(): Promise<PlatformTier>;

  /** Fetch resource limits for the given tier. */
  getLimits(tier: PlatformTier): Promise<PlatformLimits>;

  /** Return platform-aware default env vars (timeouts, intervals). */
  getDefaults(tier: PlatformTier): Record<string, string>;
}
