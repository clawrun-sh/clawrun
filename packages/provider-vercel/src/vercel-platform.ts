import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  LogsOptions,
  PlatformLimits,
  PlatformProvider,
  PlatformTier,
  PlatformStep,
  ProgressCallback,
  ProjectHandle,
  ProviderId,
  StateStoreEntry,
  StateStoreResult,
} from "@clawrun/provider";

// ---------------------------------------------------------------------------
// Lazy import — execa is CLI/SDK-only; must not be statically resolved by
// Next.js bundler (instrumentation.ts is analysed for both Node and Edge).
// ---------------------------------------------------------------------------

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(
  cmd: string,
  args: string[],
  opts?: Record<string, unknown>,
): Promise<RunResult> {
  const { execa } = await import("execa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (await execa(cmd, args, opts as any)) as any;
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    exitCode: (result.exitCode as number) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const STATE_VAR_PREFIXES = ["KV_REST_API_", "KV_URL", "KV_REST_URL"];

/** Products that can serve as a KV state store. */
const KV_PRODUCTS = ["redis", "kv", "upstash"];

/**
 * Default vercel.json — written on first deploy, patched on redeploy.
 */
const DEFAULT_VERCEL_JSON = {
  framework: "nextjs",
  regions: ["iad1"],
  crons: [{ path: "/api/v1/heartbeat", schedule: "* * * * *" }],
  functions: {
    "app/api/v1/**/*.ts": {
      maxDuration: 60,
    },
  },
};

const VERCEL_TIER_DEFAULTS: Record<PlatformTier, PlatformLimits> = {
  hobby: {
    heartbeatCron: "0 0 * * *", // daily — hobby can't do per-minute
    cpuHoursPerMonth: 5,
    maxConcurrentSandboxes: 10,
    snapshotExpirationDays: 30,
  },
  paid: {
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
  readonly id = "vercel" satisfies ProviderId;
  readonly name = "Vercel";

  // ---- Prerequisites ----------------------------------------------------

  async checkPrerequisites(onProgress?: ProgressCallback<PlatformStep>): Promise<void> {
    // Node version
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split(".")[0], 10);
    if (major < 20) {
      throw new Error(`Node.js >= 20 is required. You have v${nodeVersion}.`);
    }
    onProgress?.({ step: "check-node", message: `Node.js v${nodeVersion}` });

    // Vercel CLI
    onProgress?.({ step: "check-cli", message: "Checking Vercel CLI..." });
    try {
      const { stdout } = await run("vercel", ["--version"]);
      onProgress?.({ step: "check-cli", message: `Vercel CLI ${stdout.trim()}` });
    } catch {
      onProgress?.({ step: "install-cli", message: "Vercel CLI not found. Installing..." });
      try {
        await run("npm", ["install", "-g", "vercel"], { stdio: "pipe" });
        onProgress?.({ step: "install-cli", message: "Vercel CLI installed." });
      } catch {
        throw new Error("Failed to install Vercel CLI. Install manually: npm i -g vercel");
      }
    }

    // Vercel auth
    onProgress?.({ step: "check-auth", message: "Checking Vercel authentication..." });
    try {
      const { stdout } = await run("vercel", ["whoami"]);
      onProgress?.({ step: "check-auth", message: `Logged in as ${stdout.trim()}` });
    } catch {
      onProgress?.({ step: "login", message: "Not logged in to Vercel. Starting login..." });
      try {
        await run("vercel", ["login"], { stdio: "inherit" });
        onProgress?.({ step: "login", message: "Vercel login successful." });
      } catch {
        throw new Error("Vercel login failed. Run 'vercel login' manually.");
      }
    }
  }

  // ---- Tier detection ---------------------------------------------------

  async detectTier(): Promise<PlatformTier> {
    try {
      const currentTeam = await this.getCurrentTeam();

      if (currentTeam) {
        const { stdout } = await run("vercel", ["api", `/v2/teams/${currentTeam.id}`, "--raw"]);
        const data = JSON.parse(stdout) as {
          billing?: { plan?: string };
        };
        return planToTier(data.billing?.plan);
      }

      const { stdout } = await run("vercel", ["api", "/v2/user", "--raw"]);
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

  getDefaults(_tier: PlatformTier): Record<string, string> {
    return {};
  }

  // ---- Project lifecycle ------------------------------------------------

  getProjectUrl(name: string): string {
    return `https://${name}.vercel.app`;
  }

  async createProject(
    name: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<ProjectHandle> {
    onProgress?.({ step: "create-project", message: `Creating Vercel project "${name}"...` });

    const { stdout } = await run("vercel", [
      "api",
      "/v9/projects",
      "-X",
      "POST",
      "-f",
      `name=${name}`,
      "--raw",
    ]);
    const project = JSON.parse(stdout) as {
      id?: string;
      accountId?: string;
    };

    if (!project.id || !project.accountId) {
      throw new Error("Vercel API returned an unexpected response (missing id or accountId).");
    }

    onProgress?.({ step: "create-project", message: `Vercel project created: ${name}` });
    return {
      provider: "vercel" satisfies ProviderId,
      projectId: project.id,
      orgId: project.accountId,
    };
  }

  async deleteProject(handle: ProjectHandle): Promise<void> {
    await run("vercel", [
      "api",
      `/v9/projects/${handle.projectId}?teamId=${handle.orgId}`,
      "-X",
      "DELETE",
      "--raw",
      "--dangerously-skip-permissions",
    ]);
  }

  readProjectLink(dir: string): ProjectHandle | null {
    try {
      const data = JSON.parse(readFileSync(join(dir, ".vercel", "project.json"), "utf-8")) as {
        projectId?: string;
        orgId?: string;
      };
      if (data.projectId && data.orgId) {
        return {
          provider: "vercel" satisfies ProviderId,
          projectId: data.projectId,
          orgId: data.orgId,
        };
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
      const { stdout } = await run("vercel", ["integration", "list", "--all", "--format=json"]);
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
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<StateStoreResult> {
    onProgress?.({
      step: "connect-state-store",
      message: `Connecting store "${store.name}" to project...`,
    });

    try {
      await run(
        "vercel",
        [
          "api",
          `-X`,
          `POST`,
          `/v1/integrations/installations/${store.installationId}/resources/${store.id}/connections`,
          `-F`,
          `projectId=${projectId}`,
        ],
        { cwd: linkedDir },
      );

      onProgress?.({
        step: "connect-state-store",
        message: `Connected "${store.name}" to project.`,
      });
    } catch {
      onProgress?.({
        step: "connect-state-store",
        message: "Failed to connect store.",
        level: "warning",
      });
      return { success: false, vars: {} };
    }

    return this.pullStateVars(linkedDir, onProgress);
  }

  async provisionStateStore(
    linkedDir: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<StateStoreResult> {
    onProgress?.({ step: "provision-state-store", message: "Creating new state store..." });

    // Check if KV_REST_API_URL is already on this project (already connected)
    try {
      const { stdout } = await run("vercel", ["env", "ls"], {
        cwd: linkedDir,
      });
      if (stdout.includes("KV_REST_API_URL")) {
        onProgress?.({
          step: "provision-state-store",
          message: "State store already connected to this project.",
        });
        return this.pullStateVars(linkedDir, onProgress);
      }
    } catch {
      // ignore — proceed with provisioning
    }

    const addResult = await run("vercel", ["integration", "add", "upstash/upstash-kv"], {
      cwd: linkedDir,
      stdio: "inherit",
      reject: false,
    });

    if (addResult.exitCode !== 0) {
      onProgress?.({
        step: "provision-state-store",
        message: "State store setup cancelled.",
        level: "warning",
      });
      return { success: false, vars: {} };
    }

    // Exit code was 0 — check if vars actually appeared.
    let found = false;
    try {
      const { stdout } = await run("vercel", ["env", "ls"], { cwd: linkedDir });
      found = stdout.includes("KV_REST_API_URL");
    } catch {
      // ignore
    }

    if (!found) {
      found = await this.waitForStateStoreVars(linkedDir, onProgress);
    }

    if (!found) {
      onProgress?.({
        step: "provision-state-store",
        message: "State store setup cancelled.",
        level: "warning",
      });
      return { success: false, vars: {} };
    }

    onProgress?.({ step: "provision-state-store", message: "State store provisioned." });
    return this.pullStateVars(linkedDir, onProgress);
  }

  // ---- Env vars ---------------------------------------------------------

  async persistEnvVars(
    dir: string,
    vars: Record<string, string>,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<void> {
    // Vercel Cron requires CRON_SECRET (exact name) to set the Authorization header
    if (vars["CLAWRUN_CRON_SECRET"] && !vars["CRON_SECRET"]) {
      vars = { ...vars, CRON_SECRET: vars["CLAWRUN_CRON_SECRET"] };
    }

    const entries = Object.entries(vars);
    if (entries.length === 0) return;

    onProgress?.({
      step: "persist-env-vars",
      message: `Persisting ${entries.length} env vars to project...`,
    });

    let succeeded = 0;
    const warnings: string[] = [];
    for (const [key, value] of entries) {
      // Remove existing (ignore errors — may not exist yet)
      try {
        await run("vercel", ["env", "rm", key, "production", "--yes"], {
          cwd: dir,
        });
      } catch {
        // doesn't exist, fine
      }

      // Add at project level
      try {
        await run("vercel", ["env", "add", key, "production"], {
          cwd: dir,
          input: value,
        });
        succeeded++;
      } catch {
        warnings.push(key);
      }
    }

    onProgress?.({
      step: "persist-env-vars",
      message: `${succeeded}/${entries.length} env vars persisted to project.`,
    });
    for (const key of warnings) {
      onProgress?.({
        step: "persist-env-vars",
        message: `Could not persist ${key} to project.`,
        level: "warning",
      });
    }
  }

  // ---- Platform config --------------------------------------------------

  patchPlatformConfig(
    dir: string,
    limits: PlatformLimits,
    onProgress?: ProgressCallback<PlatformStep>,
  ): void {
    const vercelJsonPath = join(dir, "vercel.json");

    try {
      // Upsert: create from defaults if missing, then patch
      let config: { crons?: Array<{ path: string; schedule: string }>; [key: string]: unknown };
      if (existsSync(vercelJsonPath)) {
        config = JSON.parse(readFileSync(vercelJsonPath, "utf-8"));
      } else {
        config = structuredClone(DEFAULT_VERCEL_JSON);
      }

      if (config.crons) {
        for (const cron of config.crons) {
          if (cron.path === "/api/v1/heartbeat") {
            cron.schedule = limits.heartbeatCron;
          }
        }
      }

      writeFileSync(vercelJsonPath, JSON.stringify(config, null, 2) + "\n");
      onProgress?.({
        step: "patch-config",
        message: `Heartbeat cron set to: ${limits.heartbeatCron}`,
      });
    } catch {
      onProgress?.({
        step: "patch-config",
        message: "Could not patch vercel.json cron schedule.",
        level: "warning",
      });
    }
  }

  async disableDeploymentProtection(
    dir: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<void> {
    const handle = this.readProjectLink(dir);
    if (!handle) {
      onProgress?.({
        step: "disable-protection",
        message: "Could not read Vercel project config — skipping deployment protection config.",
        level: "warning",
      });
      return;
    }

    try {
      await run(
        "vercel",
        [
          "api",
          `/v9/projects/${handle.projectId}?teamId=${handle.orgId}`,
          "-X",
          "PATCH",
          "--input",
          "-",
          "--raw",
        ],
        {
          input: JSON.stringify({ ssoProtection: null }),
        },
      );
      onProgress?.({
        step: "disable-protection",
        message: "Deployment protection disabled (SSO bypass).",
      });
    } catch {
      onProgress?.({
        step: "disable-protection",
        message: "Could not disable deployment protection.",
        level: "warning",
      });
    }
  }

  // ---- Sandbox ----------------------------------------------------------

  getInfraDomains(): string[] {
    return ["*.vercel.app", "*.vercel.sh"];
  }

  getServerExternalPackages(): string[] {
    return ["@vercel/sandbox"];
  }

  getConnectArgs(dir: string, sandboxId: string): string[] {
    const data = JSON.parse(readFileSync(join(dir, ".vercel", "project.json"), "utf-8")) as {
      projectId: string;
      orgId: string;
    };
    return [sandboxId, "--project", data.projectId, "--scope", data.orgId];
  }

  // ---- Instance setup ---------------------------------------------------

  async installDependencies(
    dir: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<void> {
    onProgress?.({ step: "install-deps", message: "Installing dependencies..." });
    try {
      await run("npm", ["install"], { cwd: dir, stdio: "pipe" });
    } catch (err: unknown) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      throw new Error(
        `npm install failed in ${dir}: ${stderr || (err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  writeLocalEnv(dir: string, vars: Record<string, string>): void {
    const content = Object.entries(vars)
      .map(([key, value]) => {
        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        return `${key}="${escaped}"`;
      })
      .join("\n");
    writeFileSync(join(dir, ".env"), content + "\n");
  }

  cleanBuildCache(dir: string, cacheDir: string): void {
    const full = join(dir, cacheDir);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
    }
  }

  // ---- Deploy -----------------------------------------------------------

  async deploy(
    dir: string,
    envVars: Record<string, string>,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<string> {
    onProgress?.({ step: "deploy", message: "Deploying to Vercel..." });

    const envArgs: string[] = [];
    for (const [key, value] of Object.entries(envVars)) {
      envArgs.push("--env", `${key}=${value}`);
    }

    let result: RunResult;
    try {
      result = await run("vercel", ["deploy", "--prod", "--yes", "--force", ...envArgs], {
        cwd: dir,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      throw new Error(stderr.trim() || (err instanceof Error ? err.message : String(err)));
    }

    const deploymentUrl = result.stdout.trim().split("\n").pop()?.trim() ?? "";
    const alias = await this.resolveProductionAlias(deploymentUrl);
    const finalUrl = alias ?? deploymentUrl;
    onProgress?.({ step: "deploy", message: `Deployed to ${finalUrl}` });
    return finalUrl;
  }

  // ---- Logs -------------------------------------------------------------

  async streamLogs(deploymentUrl: string, dir: string, options?: LogsOptions): Promise<void> {
    // vercel logs <url> implies --follow. Use --no-follow unless explicitly requested.
    const args = ["logs", deploymentUrl];
    if (!options?.follow) args.push("--no-follow");
    if (options?.limit) args.push("--limit", String(options.limit));
    if (options?.json) args.push("--json");
    if (options?.query) args.push("--query", options.query);
    if (options?.since) args.push("--since", options.since);
    if (options?.level) args.push("--level", options.level);

    await run("vercel", args, { cwd: dir, stdio: "inherit" });
  }

  // ---- Private helpers --------------------------------------------------

  private async resolveProductionAlias(deploymentUrl: string): Promise<string | null> {
    try {
      const { stdout } = await run("vercel", ["inspect", deploymentUrl, "--format", "json"]);
      const data = JSON.parse(stdout) as { aliases?: string[] };
      const alias = data.aliases?.[0];
      return alias ? `https://${alias}` : null;
    } catch {
      return null;
    }
  }

  private async getCurrentTeam(): Promise<{ id: string; slug: string } | null> {
    try {
      const { stdout } = await run("vercel", ["teams", "ls", "--format", "json"]);
      const data = JSON.parse(stdout) as {
        teams: Array<{ id: string; slug: string; current?: boolean }>;
      };
      const current = data.teams.find((t) => t.current);
      return current ? { id: current.id, slug: current.slug } : null;
    } catch {
      return null;
    }
  }

  private async waitForStateStoreVars(
    linkedDir: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<boolean> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    onProgress?.({
      step: "wait-state-store",
      message: "Waiting for state store provisioning to complete...",
    });

    while (Date.now() < deadline) {
      try {
        const { stdout } = await run("vercel", ["env", "ls"], {
          cwd: linkedDir,
        });
        if (stdout.includes("KV_REST_API_URL")) {
          onProgress?.({ step: "wait-state-store", message: "State store provisioned." });
          return true;
        }
      } catch {
        // ignore — keep polling
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    onProgress?.({
      step: "wait-state-store",
      message: "Timed out waiting for state store.",
      level: "warning",
    });
    return false;
  }

  private async pullStateVars(
    linkedDir: string,
    onProgress?: ProgressCallback<PlatformStep>,
  ): Promise<StateStoreResult> {
    onProgress?.({
      step: "pull-state-vars",
      message: "Pulling state store environment variables...",
    });

    const envTempPath = join(linkedDir, ".env.state.tmp");

    try {
      await run("vercel", ["env", "pull", envTempPath, "--yes", "--environment=production"], {
        cwd: linkedDir,
      });

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

      if (!vars["KV_URL"]) {
        onProgress?.({
          step: "pull-state-vars",
          message: "State store setup incomplete: missing KV_URL.",
          level: "warning",
        });
        return { success: false, vars: {} };
      }

      const count = Object.keys(vars).length;
      onProgress?.({
        step: "pull-state-vars",
        message: `${count} state store env vars retrieved.`,
      });
      return { success: true, vars };
    } catch {
      onProgress?.({
        step: "pull-state-vars",
        message: "Could not pull state store env vars.",
        level: "warning",
      });
      return { success: false, vars: {} };
    }
  }
}
