import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { execa } from "execa";
import type {
  PlatformLimits,
  PlatformProvider,
  PlatformTier,
  ProjectHandle,
  StateStoreEntry,
  StateStoreResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const STATE_VAR_PREFIXES = ["KV_REST_API_", "KV_URL", "KV_REST_URL"];

/** Products that can serve as a KV state store. */
const KV_PRODUCTS = ["redis", "kv", "upstash"];

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

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function planToTier(plan: string | undefined): PlatformTier {
  if (!plan || plan === "hobby") return "hobby";
  return "paid"; // pro, enterprise, etc.
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function isStateVar(key: string): boolean {
  return STATE_VAR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isKvProduct(product: string): boolean {
  const lower = product.toLowerCase();
  return KV_PRODUCTS.some((p) => lower.includes(p));
}

// ---------------------------------------------------------------------------
// VercelPlatformProvider
// ---------------------------------------------------------------------------

export class VercelPlatformProvider implements PlatformProvider {
  readonly id = "vercel";
  readonly name = "Vercel";

  // ---- Prerequisites ----------------------------------------------------

  async checkPrerequisites(): Promise<void> {
    // Node version
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split(".")[0], 10);
    if (major < 20) {
      clack.log.error(`Node.js >= 20 is required. You have v${nodeVersion}.`);
      process.exit(1);
    }
    clack.log.success(`Node.js v${nodeVersion}`);

    // Vercel CLI
    const vercelSpinner = clack.spinner();
    vercelSpinner.start("Checking Vercel CLI");
    try {
      const { stdout } = await execa("vercel", ["--version"]);
      vercelSpinner.stop(`Vercel CLI ${stdout.trim()}`);
    } catch {
      vercelSpinner.stop("Vercel CLI not found");
      clack.log.step("Installing Vercel CLI...");
      try {
        await execa("npm", ["install", "-g", "vercel"], { stdio: "inherit" });
        clack.log.success("Vercel CLI installed.");
      } catch {
        clack.log.error("Failed to install Vercel CLI. Install manually: npm i -g vercel");
        process.exit(1);
      }
    }

    // Vercel auth
    const authSpinner = clack.spinner();
    authSpinner.start("Checking Vercel authentication");
    try {
      const { stdout } = await execa("vercel", ["whoami"]);
      authSpinner.stop(`Logged in as ${chalk.bold(stdout.trim())}`);
    } catch {
      authSpinner.stop("Not logged in to Vercel");
      clack.log.step("Starting Vercel login...");
      try {
        await execa("vercel", ["login"], { stdio: "inherit" });
        clack.log.success("Vercel login successful.");
      } catch {
        clack.log.error("Vercel login failed. Run 'vercel login' manually.");
        process.exit(1);
      }
    }
  }

  // ---- Tier detection ---------------------------------------------------

  async detectTier(): Promise<PlatformTier> {
    try {
      const currentTeam = await this.getCurrentTeam();

      if (currentTeam) {
        const { stdout } = await execa("vercel", [
          "api", `/v2/teams/${currentTeam.id}`, "--raw",
        ]);
        const data = JSON.parse(stdout) as {
          billing?: { plan?: string };
        };
        return planToTier(data.billing?.plan);
      }

      const { stdout } = await execa("vercel", ["api", "/v2/user", "--raw"]);
      const data = JSON.parse(stdout) as {
        user?: { billing?: { plan?: string } };
      };
      return planToTier(data.user?.billing?.plan);
    } catch {
      return "hobby";
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

  // ---- Project lifecycle ------------------------------------------------

  async createProject(name: string): Promise<ProjectHandle> {
    console.log(chalk.dim(`  Creating Vercel project "${name}"...`));

    const { stdout } = await execa("vercel", [
      "api", "/v9/projects",
      "-X", "POST",
      "-f", `name=${name}`,
      "--raw",
    ]);
    const project = JSON.parse(stdout) as {
      id?: string;
      accountId?: string;
    };

    if (!project.id || !project.accountId) {
      throw new Error("Vercel API returned an unexpected response (missing id or accountId).");
    }

    console.log(chalk.green(`  Vercel project created: ${name}`));
    return { provider: "vercel", projectId: project.id, orgId: project.accountId };
  }

  async deleteProject(handle: ProjectHandle): Promise<void> {
    await execa("vercel", [
      "api", `/v9/projects/${handle.projectId}?teamId=${handle.orgId}`,
      "-X", "DELETE",
      "--raw",
      "--dangerously-skip-permissions",
    ]);
  }

  readProjectLink(dir: string): ProjectHandle | null {
    try {
      const data = JSON.parse(
        readFileSync(join(dir, ".vercel", "project.json"), "utf-8"),
      ) as { projectId?: string; orgId?: string };
      if (data.projectId && data.orgId) {
        return { provider: "vercel", projectId: data.projectId, orgId: data.orgId };
      }
    } catch {
      // .vercel/project.json may not exist yet
    }
    return null;
  }

  writeProjectLink(dir: string, handle: ProjectHandle): void {
    const vercelDir = join(dir, ".vercel");
    mkdirSync(vercelDir, { recursive: true });
    writeFileSync(
      join(vercelDir, "project.json"),
      JSON.stringify({ projectId: handle.projectId, orgId: handle.orgId }) + "\n",
    );
  }

  // ---- State store ------------------------------------------------------

  async listStateStores(): Promise<StateStoreEntry[]> {
    try {
      const { stdout } = await execa(
        "vercel",
        ["integration", "list", "--all", "--format=json"],
      );
      const parsed = JSON.parse(stdout) as { resources?: StateStoreEntry[] };
      return (parsed.resources ?? []).filter(
        (r) => r.status === "available" && isKvProduct(r.product),
      );
    } catch {
      return [];
    }
  }

  async connectStateStore(
    linkedDir: string,
    store: StateStoreEntry,
    projectId: string,
  ): Promise<StateStoreResult> {
    const spinner = clack.spinner();
    spinner.start(`Connecting store "${store.name}" to project`);

    try {
      await execa("vercel", [
        "api",
        `-X`, `POST`,
        `/v1/integrations/installations/${store.installationId}/resources/${store.id}/connections`,
        `-F`, `projectId=${projectId}`,
      ], { cwd: linkedDir });

      spinner.stop(`Connected "${store.name}" to project.`);
    } catch (err) {
      spinner.stop(`Failed to connect store.`);
      clack.log.error(err instanceof Error ? err.message : String(err));
      return { success: false, vars: {} };
    }

    return this.pullStateVars(linkedDir);
  }

  async provisionStateStore(linkedDir: string): Promise<StateStoreResult> {
    clack.log.step("Creating new state store...");

    // Check if KV_REST_API_URL is already on this project (already connected)
    try {
      const { stdout } = await execa("vercel", ["env", "ls"], {
        cwd: linkedDir,
      });
      if (stdout.includes("KV_REST_API_URL")) {
        clack.log.info("State store already connected to this project.");
        return this.pullStateVars(linkedDir);
      }
    } catch {
      // ignore — proceed with provisioning
    }

    const addResult = await execa(
      "vercel",
      ["integration", "add", "upstash/upstash-kv"],
      { cwd: linkedDir, stdio: "inherit", reject: false },
    );

    if (addResult.exitCode !== 0) {
      clack.log.warn("State store setup cancelled.");
      return { success: false, vars: {} };
    }

    // Exit code was 0 — check if vars actually appeared.
    let found = false;
    try {
      const { stdout } = await execa("vercel", ["env", "ls"], { cwd: linkedDir });
      found = stdout.includes("KV_REST_API_URL");
    } catch {
      // ignore
    }

    if (!found) {
      found = await this.waitForStateStoreVars(linkedDir);
    }

    if (!found) {
      clack.log.warn("State store setup cancelled.");
      return { success: false, vars: {} };
    }

    clack.log.success("State store provisioned.");
    return this.pullStateVars(linkedDir);
  }

  // ---- Env vars ---------------------------------------------------------

  async persistEnvVars(
    dir: string,
    vars: Record<string, string>,
  ): Promise<void> {
    // Vercel Cron requires CRON_SECRET (exact name) to set the Authorization header
    if (vars["CLOUDCLAW_CRON_SECRET"] && !vars["CRON_SECRET"]) {
      vars = { ...vars, CRON_SECRET: vars["CLOUDCLAW_CRON_SECRET"] };
    }

    const entries = Object.entries(vars);
    if (entries.length === 0) return;

    console.log(chalk.dim("  Persisting env vars to project level..."));

    let succeeded = 0;
    for (const [key, value] of entries) {
      // Remove existing (ignore errors — may not exist yet)
      try {
        await execa("vercel", ["env", "rm", key, "production", "--yes"], {
          cwd: dir,
        });
      } catch {
        // doesn't exist, fine
      }

      // Add at project level
      try {
        await execa("vercel", ["env", "add", key, "production"], {
          cwd: dir,
          input: value,
        });
        succeeded++;
      } catch {
        console.log(chalk.yellow(`  Warning: could not persist ${key} to project.`));
      }
    }

    console.log(
      chalk.green(`  ${succeeded}/${entries.length} env vars persisted to project.`),
    );
  }

  // ---- Platform config --------------------------------------------------

  patchPlatformConfig(dir: string, limits: PlatformLimits): void {
    const vercelJsonPath = join(dir, "vercel.json");
    if (!existsSync(vercelJsonPath)) return;

    try {
      const content = readFileSync(vercelJsonPath, "utf-8");
      const config = JSON.parse(content) as {
        crons?: Array<{ path: string; schedule: string }>;
        [key: string]: unknown;
      };

      if (config.crons) {
        for (const cron of config.crons) {
          if (cron.path === "/api/cron/heartbeat") {
            cron.schedule = limits.heartbeatCron;
          }
        }
      }

      writeFileSync(vercelJsonPath, JSON.stringify(config, null, 2) + "\n");
      console.log(chalk.green(`  Heartbeat cron set to: ${limits.heartbeatCron}`));
    } catch {
      console.log(chalk.yellow("  Could not patch vercel.json cron schedule."));
    }
  }

  async disableDeploymentProtection(dir: string): Promise<void> {
    const handle = this.readProjectLink(dir);
    if (!handle) {
      console.log(chalk.yellow("  Could not read Vercel project config — skipping deployment protection config."));
      return;
    }

    try {
      await execa("vercel", [
        "api",
        `/v9/projects/${handle.projectId}?teamId=${handle.orgId}`,
        "-X", "PATCH",
        "--input", "-",
        "--raw",
      ], {
        input: JSON.stringify({ ssoProtection: null }),
      });
      console.log(chalk.green("  Deployment protection disabled (SSO bypass)."));
    } catch {
      console.log(chalk.yellow("  Could not disable deployment protection."));
    }
  }

  // ---- Deploy -----------------------------------------------------------

  async deploy(
    dir: string,
    envVars: Record<string, string>,
  ): Promise<string> {
    console.log(chalk.cyan("\nDeploying to Vercel...\n"));

    const envArgs: string[] = [];
    for (const [key, value] of Object.entries(envVars)) {
      envArgs.push("--env", `${key}=${value}`);
    }

    try {
      const { stdout } = await execa(
        "vercel",
        ["deploy", "--prod", "--yes", "--force", ...envArgs],
        {
          cwd: dir,
          stdio: ["inherit", "pipe", "inherit"],
        },
      );

      const url = stdout.trim().split("\n").pop()?.trim() ?? "";
      return url;
    } catch (error) {
      console.error(chalk.red("\nDeployment failed."));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  }

  // ---- Private helpers --------------------------------------------------

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

  private async waitForStateStoreVars(linkedDir: string): Promise<boolean> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    process.stdout.write(
      chalk.dim("  Waiting for state store provisioning to complete"),
    );

    while (Date.now() < deadline) {
      try {
        const { stdout } = await execa("vercel", ["env", "ls"], {
          cwd: linkedDir,
        });
        if (stdout.includes("KV_REST_API_URL")) {
          process.stdout.write("\n");
          return true;
        }
      } catch {
        // ignore — keep polling
      }

      process.stdout.write(chalk.dim("."));
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    process.stdout.write("\n");
    return false;
  }

  private async pullStateVars(linkedDir: string): Promise<StateStoreResult> {
    const spinner = clack.spinner();
    spinner.start("Pulling state store environment variables");

    const envTempPath = join(linkedDir, ".env.state.tmp");

    try {
      await execa(
        "vercel",
        ["env", "pull", envTempPath, "--yes", "--environment=production"],
        { cwd: linkedDir },
      );

      const pulled = parseEnvFile(readFileSync(envTempPath, "utf-8"));
      const vars: Record<string, string> = {};
      for (const [key, value] of Object.entries(pulled)) {
        if (isStateVar(key)) {
          vars[key] = value;
        }
      }

      try {
        unlinkSync(envTempPath);
      } catch {
        // ignore
      }

      if (!vars["KV_REST_API_URL"] || !vars["KV_REST_API_TOKEN"]) {
        spinner.stop("State store setup incomplete: missing KV_REST_API_URL or KV_REST_API_TOKEN.");
        return { success: false, vars: {} };
      }

      const count = Object.keys(vars).length;
      spinner.stop(`${count} state store env vars retrieved.`);
      return { success: true, vars };
    } catch {
      spinner.stop("Could not pull state store env vars.");
      return { success: false, vars: {} };
    }
  }
}
