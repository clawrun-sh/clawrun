import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import chalk from "chalk";
import { humanId } from "human-id";
import { getPreset, listPresets } from "../presets/index.js";
import { collectEnvVars } from "../deploy/env.js";
import {
  checkPrerequisites,
  createVercelProject,
  deleteVercelProject,
  deployToVercel,
  disableDeploymentProtection,
  persistEnvVarsToProject,
  writeVercelLink,
} from "../deploy/vercel.js";
import type { VercelProjectInfo } from "../deploy/vercel.js";
import { provisionDatabase } from "../deploy/database.js";
import {
  createInstance,
  instanceExists,
  getInstance,
  instanceDir,
  saveDeployedUrl,
  upgradeInstance,
  patchVercelJson,
} from "../instance/index.js";
import { getPlatformProvider } from "../platform/index.js";
import type { PlatformTier, PlatformLimits } from "../platform/index.js";

function printBanner(): void {
  console.log(
    chalk.bold.cyan(`
   _____ _                 _  _____ _
  / ____| |               | |/ ____| |
 | |    | | ___  _   _  __| | |    | | __ ___      __
 | |    | |/ _ \\| | | |/ _\` | |    | |/ _\` \\ \\ /\\ / /
 | |____| | (_) | |_| | (_| | |____| | (_| |\\ V  V /
  \\_____|_|\\___/ \\__,_|\\__,_|\\_____|_|\\__,_| \\_/\\_/
`)
  );
  console.log(chalk.dim("  AI agent hosting, simplified.\n"));
}

function generateInstanceName(): string {
  return humanId({ separator: "-", capitalize: false });
}

export async function deployCommand(
  nameOrPreset?: string,
  options: { yes?: boolean; preset?: string } = {},
): Promise<void> {
  printBanner();

  // Determine if the argument is a preset name or an instance name.
  // If it matches a known preset and no instance with that name exists,
  // treat it as "create new instance with this preset".
  const presetNames = listPresets().map((p) => p.id);
  let instanceName: string | undefined;
  let presetId: string | undefined = options.preset;

  if (nameOrPreset) {
    if (instanceExists(nameOrPreset)) {
      // Existing instance — redeploy/upgrade path
      instanceName = nameOrPreset;
    } else if (presetNames.includes(nameOrPreset)) {
      // Argument matches a preset — create new instance with auto-generated name
      presetId = nameOrPreset;
    } else {
      // Argument is a new instance name
      instanceName = nameOrPreset;
    }
  }

  // PATH B: Existing instance — upgrade + redeploy
  if (instanceName && instanceExists(instanceName)) {
    return handleExistingInstance(instanceName, options);
  }

  // PATH A: New instance
  return handleNewInstance(instanceName, presetId, options);
}

async function detectAndPrintTier(): Promise<{
  tier: PlatformTier;
  limits: PlatformLimits;
  tierDefaults: Record<string, string>;
}> {
  const platform = getPlatformProvider("vercel");
  const tier = await platform.detectTier();
  const limits = await platform.getLimits(tier);
  const tierDefaults = platform.getDefaults(tier);

  if (tier === "hobby") {
    console.log(chalk.bold("\n  Detected Vercel Hobby (free) plan.\n"));
    console.log(chalk.dim("  Defaults optimized for the free tier:"));
    console.log(chalk.dim(`    Heartbeat cron:    ${limits.heartbeatCron} (daily)`));
    console.log(chalk.dim(`    Sandbox timeout:   ${tierDefaults.CLOUDCLAW_SANDBOX_TIMEOUT ?? "30"} minutes`));
    console.log(chalk.dim(`    Active duration:   ${tierDefaults.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "10"} minutes per session`));
    console.log(chalk.dim("    Lifecycle mode:    webhook-driven (sandbox starts on incoming message)"));
    console.log();
    console.log(
      chalk.dim(
        "  To unlock per-minute heartbeat and always-on mode, upgrade your\n" +
        "  Vercel plan and run `cloudclaw deploy <instance>` again to pick\n" +
        "  up the new limits automatically.",
      ),
    );
  } else {
    console.log(chalk.bold("\n  Detected Vercel Pro plan.\n"));
    console.log(chalk.dim("  Defaults for the full feature set:"));
    console.log(chalk.dim(`    Heartbeat cron:    ${limits.heartbeatCron} (every minute)`));
    console.log(chalk.dim(`    Sandbox timeout:   ${tierDefaults.CLOUDCLAW_SANDBOX_TIMEOUT ?? "240"} minutes`));
    console.log(chalk.dim(`    Active duration:   ${tierDefaults.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "5"} minutes (duty-cycle)`));
    console.log(chalk.dim("    Lifecycle mode:    heartbeat-driven (full cron + always-on support)"));
  }

  console.log();
  return { tier, limits, tierDefaults };
}

async function handleNewInstance(
  instanceName: string | undefined,
  presetId: string | undefined,
  options: { yes?: boolean },
): Promise<void> {
  // Resolve preset (default to zeroclaw-basic if only one exists)
  if (!presetId) {
    const presets = listPresets();
    if (presets.length === 1) {
      presetId = presets[0].id;
    } else {
      console.error(
        chalk.red("Please specify a preset: cloudclaw deploy <preset>"),
      );
      console.error(
        chalk.dim(
          `  Available: ${presets.map((p) => p.id).join(", ")}`,
        ),
      );
      process.exit(1);
    }
  }

  const preset = getPreset(presetId);
  if (!preset) {
    const available = listPresets()
      .map((p) => p.id)
      .join(", ");
    console.error(
      chalk.red(`Unknown preset: "${presetId}". Available: ${available}`),
    );
    process.exit(1);
  }

  // Generate instance name if not provided
  const name = instanceName ?? generateInstanceName();

  console.log(chalk.bold(`Creating new instance: ${name}`));
  console.log(chalk.dim(`  Preset: ${preset.name}`));
  console.log(chalk.dim(`  ${preset.description}\n`));

  // Check prerequisites
  console.log(chalk.bold("Checking prerequisites..."));
  await checkPrerequisites();

  // Detect tier and print plan info
  const { limits, tierDefaults } = await detectAndPrintTier();

  // Collect env vars (tier defaults pre-fill prompts)
  const envVars = await collectEnvVars(preset, options.yes ?? false, tierDefaults);

  // ===================================================================
  // Phase 1: Provision database (hard gate)
  //
  // Create a Vercel project via API (instant, no deploy needed) and
  // run the Neon integration from a temp directory. If the DB fails,
  // only an empty project exists — cheap rollback, no instance built.
  // ===================================================================

  let projectInfo: VercelProjectInfo;
  try {
    projectInfo = await createVercelProject(name);
  } catch (err) {
    console.error(chalk.red(`\n  Failed to create Vercel project: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  // Temp dir with just .vercel/project.json — enough for vercel CLI commands
  const tempDir = join(tmpdir(), `cloudclaw-setup-${name}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  writeVercelLink(tempDir, projectInfo);

  const dbResult = await provisionDatabase(tempDir);
  if (!dbResult.success) {
    console.error(chalk.red("\nRolling back: removing Vercel project.\n"));
    await deleteVercelProject(projectInfo);
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Clean up temp dir (we'll write the link into the real instance dir)
  rmSync(tempDir, { recursive: true, force: true });

  // ===================================================================
  // Phase 2: Build instance + deploy
  //
  // DB is healthy — merge DB vars into env and build the full instance.
  // ===================================================================

  const allEnvVars = { ...envVars, ...dbResult.dbVars };

  // Create instance (scaffold, npm install, templates)
  const dir = await createInstance(name, preset.id, preset.agent, allEnvVars);

  // Write the Vercel project link into the instance dir
  writeVercelLink(dir, projectInfo);

  // Patch vercel.json with plan-aware cron schedule
  patchVercelJson(dir, limits.heartbeatCron);

  // Disable Vercel Deployment Protection (SSO) so webhooks can reach the app
  await disableDeploymentProtection(dir);

  // Persist all env vars to Vercel project level
  await persistEnvVarsToProject(dir, allEnvVars);

  // Deploy
  let url = await deployToVercel(dir, allEnvVars);
  saveDeployedUrl(name, url);

  // Start sandbox — user can chat immediately.
  // Extend loop handles lifecycle. Heartbeat manages hooks.
  console.log(chalk.cyan("\nStarting sandbox...\n"));
  const cronSecret = allEnvVars["CLOUDCLAW_CRON_SECRET"];
  if (cronSecret) {
    try {
      const res = await fetch(`${url}/api/cron/heartbeat?restart=true`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const result = await res.json() as Record<string, unknown>;
      console.log(chalk.dim(`  Sandbox: ${result.action ?? "ok"}`));
    } catch (err) {
      console.log(chalk.yellow("  Could not start sandbox — it will start on first message."));
    }
  }

  // Success
  const botToken = allEnvVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken);
}

function readInstanceEnv(dir: string): Record<string, string> {
  const envPath = join(dir, ".env");
  const vars: Record<string, string> = {};
  try {
    const content = readFileSync(envPath, "utf-8");
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
  } catch {
    // .env might not exist
  }
  return vars;
}

async function handleExistingInstance(
  name: string,
  options: { yes?: boolean },
): Promise<void> {
  const meta = getInstance(name);
  if (!meta) {
    console.error(chalk.red(`Instance "${name}" not found.`));
    process.exit(1);
  }

  const dir = instanceDir(name);

  console.log(chalk.bold(`Redeploying instance: ${name}`));
  console.log(chalk.dim(`  Preset: ${meta.preset}`));
  console.log(chalk.dim(`  @cloudclaw/app: ${meta.appVersion}`));
  if (meta.deployedUrl) {
    console.log(chalk.dim(`  Last deployed to: ${meta.deployedUrl}`));
  }
  console.log();

  // Check prerequisites
  console.log(chalk.bold("Checking prerequisites..."));
  await checkPrerequisites();

  // Detect tier (may have changed since last deploy)
  const { limits } = await detectAndPrintTier();

  // Upgrade instance (reinstall deps, reapply templates)
  await upgradeInstance(name);

  // Patch vercel.json with plan-aware cron schedule
  patchVercelJson(dir, limits.heartbeatCron);

  // Read env vars — pass CLOUDCLAW_* to deploy so new vars are always available
  const envVars = readInstanceEnv(dir);
  const cloudclawEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    if (key.startsWith("CLOUDCLAW_")) {
      cloudclawEnv[key] = value;
    }
  }

  // Persist any new CLOUDCLAW_ vars to project level
  await persistEnvVarsToProject(dir, cloudclawEnv);

  // Deploy with CLOUDCLAW_ env vars
  const url = await deployToVercel(dir, cloudclawEnv);

  // Save URL
  saveDeployedUrl(name, url);

  // Restart sandbox with new code — extend loop handles lifecycle, heartbeat manages hooks.
  console.log(chalk.cyan("\nRestarting sandbox...\n"));
  const cronSecret = envVars["CLOUDCLAW_CRON_SECRET"];
  if (cronSecret) {
    try {
      const res = await fetch(`${url}/api/cron/heartbeat?restart=true`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const result = await res.json() as Record<string, unknown>;
      console.log(chalk.dim(`  Sandbox: ${result.action ?? "ok"}`));
    } catch (err) {
      console.log(chalk.yellow("  Could not restart sandbox — it will start on first message."));
      console.log(chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // Success
  const botToken = envVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken ?? null);
}

function printSuccess(
  name: string,
  url: string,
  botToken: string | null,
): void {
  console.log(chalk.bold.green("\nDeployment successful!\n"));
  console.log(`  ${chalk.bold("Instance:")} ${chalk.cyan(name)}`);
  console.log(`  ${chalk.bold("URL:")} ${chalk.cyan(url)}`);
  console.log(`  ${chalk.bold("Health:")} ${chalk.cyan(`${url}/api/health`)}`);

  if (botToken) {
    console.log(
      chalk.dim(
        "\n  Your agent is live! Message your Telegram bot to start chatting.",
      ),
    );
  }

  console.log();
}
