import { execa } from "execa";
import type { PlatformLimits, PlatformProvider, PlatformTier } from "./types.js";

const VERCEL_TIER_DEFAULTS: Record<PlatformTier, PlatformLimits> = {
  hobby: {
    maxSandboxTimeoutMs: 45 * 60 * 1000,
    heartbeatCron: "0 0 * * *", // daily — hobby can't do per-minute
    cpuHoursPerMonth: 5,
    maxConcurrentSandboxes: 10,
    snapshotExpirationDays: 30,
  },
  paid: {
    maxSandboxTimeoutMs: 5 * 60 * 60 * 1000,
    heartbeatCron: "* * * * *", // every minute
    cpuHoursPerMonth: null,
    maxConcurrentSandboxes: 100,
    snapshotExpirationDays: 30,
  },
};

function planToTier(plan: string | undefined): PlatformTier {
  if (!plan || plan === "hobby") return "hobby";
  return "paid"; // pro, enterprise, etc.
}

export class VercelPlatformProvider implements PlatformProvider {
  readonly id = "vercel";
  readonly name = "Vercel";

  /**
   * Detect the billing plan of the scope that `vercel deploy` will target.
   *
   * The CLI's active team (set via `vercel switch`) determines where deploys
   * go — this is NOT the same as the user's personal plan. A user can be on
   * the hobby plan while their active team is on pro.
   *
   * Strategy:
   *   1. `vercel teams ls --format json` → find the team with `current: true`
   *   2. If found → `vercel api /v2/teams/<id>` → read `billing.plan`
   *   3. If no current team → `vercel api /v2/user` → personal account plan
   *   4. Falls back to "hobby" on any error
   */
  async detectTier(): Promise<PlatformTier> {
    try {
      // Step 1: Which team is the CLI currently scoped to?
      const currentTeam = await this.getCurrentTeam();

      if (currentTeam) {
        // Step 2: Get that team's billing plan
        const { stdout } = await execa("vercel", [
          "api", `/v2/teams/${currentTeam.id}`, "--raw",
        ]);
        const data = JSON.parse(stdout) as {
          billing?: { plan?: string };
        };
        return planToTier(data.billing?.plan);
      }

      // Step 3: No team selected — personal account
      const { stdout } = await execa("vercel", ["api", "/v2/user", "--raw"]);
      const data = JSON.parse(stdout) as {
        user?: { billing?: { plan?: string } };
      };
      return planToTier(data.user?.billing?.plan);
    } catch {
      return "hobby";
    }
  }

  /**
   * Find the CLI's currently active team, if any.
   * Returns null when the user is scoped to their personal account.
   */
  private async getCurrentTeam(): Promise<{ id: string; slug: string } | null> {
    try {
      const { stdout } = await execa("vercel", ["teams", "ls", "--format", "json"]);
      const data = JSON.parse(stdout) as {
        teams: Array<{ id: string; slug: string; current?: boolean }>;
      };
      const current = data.teams.find((t) => t.current);
      return current ? { id: current.id, slug: current.slug } : null;
    } catch {
      return null;
    }
  }

  async getLimits(tier: PlatformTier): Promise<PlatformLimits> {
    return VERCEL_TIER_DEFAULTS[tier];
  }

  getDefaults(tier: PlatformTier): Record<string, string> {
    if (tier === "hobby") {
      return {
        CLOUDCLAW_SANDBOX_ACTIVE_DURATION: "10", // 10 min
        CLOUDCLAW_SANDBOX_TIMEOUT: "30", // 30 min safety net
      };
    }
    return {
      CLOUDCLAW_SANDBOX_ACTIVE_DURATION: "5",
      CLOUDCLAW_SANDBOX_TIMEOUT: "240", // 4 hr
    };
  }
}
