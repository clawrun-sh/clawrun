import type { ExtendPayload } from "./lifecycle";

/**
 * A single reason that may justify extending a sandbox's timeout.
 * Evaluated in order — first match wins.
 */
export interface ExtendReason {
  /** Returns a human-readable label if this reason justifies extending, null otherwise. */
  evaluate(payload: ExtendPayload, now: number): string | null;
}

/**
 * Extend unconditionally while the sandbox is within its initial grace period.
 * This prevents premature idle-stop decisions before the agent has had time
 * to initialise and produce file activity.
 */
export class GracePeriodReason implements ExtendReason {
  constructor(private gracePeriodMs: number) {}

  evaluate(payload: ExtendPayload, now: number): string | null {
    if (!payload.sandboxCreatedAt) return null;
    const elapsed = now - payload.sandboxCreatedAt;
    return elapsed < this.gracePeriodMs
      ? `grace period (${Math.round(elapsed / 1000)}s / ${this.gracePeriodMs / 1000}s)`
      : null;
  }
}

/**
 * Extend if files in ZEROCLAW_HOME have changed recently (sandbox is "active").
 */
export class FileActivityReason implements ExtendReason {
  constructor(private activeDurationMs: number) {}

  evaluate(payload: ExtendPayload, now: number): string | null {
    const idleMs = now - payload.lastChangedAt;
    return idleMs < this.activeDurationMs
      ? `active (idle ${Math.round(idleMs / 1000)}s)`
      : null;
  }
}

/**
 * Extend if a cron job is scheduled to run within the keep-alive window.
 */
export class CronScheduleReason implements ExtendReason {
  constructor(private keepAliveWindowMs: number) {}

  evaluate(payload: ExtendPayload, now: number): string | null {
    if (!payload.nextCronAt) return null;
    const msUntilCron = new Date(payload.nextCronAt).getTime() - now;
    // Past timestamps are not a reason to extend — they indicate a cron
    // that already fired. Without this guard, negative msUntilCron would
    // always be < keepAliveWindowMs, keeping the sandbox alive forever.
    if (msUntilCron <= 0) return null;
    return msUntilCron < this.keepAliveWindowMs ? "cron due soon" : null;
  }
}
