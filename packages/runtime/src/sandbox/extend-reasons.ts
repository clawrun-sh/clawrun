import type { CronInfo } from "@clawrun/agent";
import type { ExtendPayload } from "./lifecycle.js";

/**
 * A single reason that may justify extending a sandbox's timeout.
 * Evaluated in order — first match wins.
 */
export interface ExtendReason {
  /** Returns a human-readable label if this reason justifies extending, null otherwise. */
  evaluate(payload: ExtendPayload, now: number, cronInfo?: CronInfo): string | null;
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
 * Extend if files in the agent workspace have changed recently (sandbox is "active").
 */
export class FileActivityReason implements ExtendReason {
  constructor(private activeDurationMs: number) {}

  evaluate(payload: ExtendPayload, now: number): string | null {
    const idleMs = now - payload.lastChangedAt;
    return idleMs < this.activeDurationMs ? `active (idle ${Math.round(idleMs / 1000)}s)` : null;
  }
}

/**
 * Extend if a cron job is scheduled to run within the keep-alive window.
 */
export class CronScheduleReason implements ExtendReason {
  constructor(private keepAliveWindowMs: number) {}

  evaluate(_payload: ExtendPayload, now: number, cronInfo?: CronInfo): string | null {
    if (!cronInfo || cronInfo.jobs.length === 0) return null;

    const nextRunMs = cronInfo.jobs
      .map((j) => new Date(j.nextRunAt).getTime())
      .filter((t) => !isNaN(t) && t > now)
      .sort((a, b) => a - b)[0];

    if (!nextRunMs) return null;
    const msUntilCron = nextRunMs - now;
    return msUntilCron < this.keepAliveWindowMs ? "cron due soon" : null;
  }
}
