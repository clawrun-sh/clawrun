import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import chalk from "chalk";
import { humanId } from "human-id";
import * as clack from "@clack/prompts";
import { getPreset, listPresets } from "../presets/index.js";
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
import { provisionRedis } from "../deploy/redis.js";
import {
  createInstance,
  instanceExists,
  getInstance,
  instanceDir,
  saveDeployedUrl,
  upgradeInstance,
  patchVercelJson,
  buildConfig,
  toEnvVars,
  readConfig,
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
`),
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
  const presetNames = listPresets().map((p) => p.id);
  let instanceName: string | undefined;
  let presetId: string | undefined = options.preset;

  if (nameOrPreset) {
    if (instanceExists(nameOrPreset)) {
      instanceName = nameOrPreset;
    } else if (presetNames.includes(nameOrPreset)) {
      presetId = nameOrPreset;
    } else {
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
    clack.log.info(
      `${chalk.bold("Vercel Hobby (free) plan detected")}\n` +
      chalk.dim(`  Heartbeat cron:    ${limits.heartbeatCron} (daily)\n`) +
      chalk.dim(`  Sandbox timeout:   ${tierDefaults.CLOUDCLAW_SANDBOX_TIMEOUT ?? "30"} minutes\n`) +
      chalk.dim(`  Active duration:   ${tierDefaults.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "10"} minutes per session\n`) +
      chalk.dim("  Lifecycle mode:    webhook-driven"),
    );
  } else {
    clack.log.info(
      `${chalk.bold("Vercel Pro plan detected")}\n` +
      chalk.dim(`  Heartbeat cron:    ${limits.heartbeatCron} (every minute)\n`) +
      chalk.dim(`  Sandbox timeout:   ${tierDefaults.CLOUDCLAW_SANDBOX_TIMEOUT ?? "240"} minutes\n`) +
      chalk.dim(`  Active duration:   ${tierDefaults.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "5"} minutes (duty-cycle)\n`) +
      chalk.dim("  Lifecycle mode:    heartbeat-driven"),
    );
  }

  return { tier, limits, tierDefaults };
}

async function handleNewInstance(
  instanceName: string | undefined,
  presetId: string | undefined,
  options: { yes?: boolean },
): Promise<void> {
  // Resolve preset
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

  clack.intro(chalk.bold.cyan("CloudClaw Setup"));

  // Instance name
  const name = instanceName ?? generateInstanceName();
  clack.log.step(`Instance: ${chalk.bold(name)}`);
  clack.log.info(`Preset: ${preset.name} — ${preset.description}`);

  // Check prerequisites
  clack.log.step("Checking prerequisites...");
  await checkPrerequisites();

  // Detect tier
  const { limits, tierDefaults } = await detectAndPrintTier();
  const defaultActiveDuration = parseInt(tierDefaults.CLOUDCLAW_SANDBOX_ACTIVE_DURATION ?? "5", 10);

  // ============================================================
  // Agent config via napi-rs (required — no fallback)
  // ============================================================

  let napi: typeof import("zeroclaw-napi");
  try {
    napi = await import("zeroclaw-napi");
  } catch (err) {
    clack.log.error(
      `ZeroClaw native bridge is required but could not be loaded.\n` +
      chalk.dim(`  ${err instanceof Error ? err.message : String(err)}\n`) +
      chalk.dim("  Run: cd packages/zeroclaw-napi && bash build-docker.sh"),
    );
    process.exit(1);
  }

  // Memory backend
  let memoryBackend = "sqlite";
  const backends = napi.getMemoryBackends();

  if (!options.yes) {
    const selected = await clack.select({
      message: "Select agent memory backend",
      options: backends.map((b: { key: string; label: string }) => ({
        value: b.key,
        label: b.label,
      })),
      initialValue: "sqlite",
    });

    if (clack.isCancel(selected)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    memoryBackend = selected as string;
  }

  // Provider setup via ZeroClaw's interactive wizard
  clack.log.step("Configuring LLM provider...");
  clack.log.info(chalk.dim("ZeroClaw's provider wizard will guide you through setup.\n"));

  const providerResult = await napi.runProviderWizard();
  clack.log.success(
    `Provider: ${chalk.green(providerResult.provider)} | Model: ${chalk.green(providerResult.model)}`,
  );

  // Channel setup via ZeroClaw's interactive wizard
  if (!options.yes) {
    const configureChannels = await clack.confirm({
      message: "Configure messaging channels? (Telegram, Discord, Slack, etc.)",
      initialValue: true,
    });

    if (clack.isCancel(configureChannels)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (configureChannels) {
      clack.log.step("Configuring channels...");
      clack.log.info(chalk.dim("ZeroClaw's channel wizard will guide you through setup.\n"));
      await napi.runChannelWizard();
      clack.log.success("Channel configuration saved.");
    }
  }

  // Read the full assembled config from ZeroClaw
  const agentConfigJson = await napi.getSavedConfig();

  // CloudClaw-specific settings
  const activeDuration = defaultActiveDuration;
  const cronSecret = randomUUID();
  const nextAuthSecret = randomUUID();
  const webhookSecret = randomUUID();

  // ============================================================
  // Phase 1: Provision database (hard gate)
  // ============================================================

  let projectInfo: VercelProjectInfo;
  try {
    projectInfo = await createVercelProject(name);
  } catch (err) {
    clack.log.error(`Failed to create Vercel project: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Temp dir for DB provisioning
  const tempDir = join(tmpdir(), `cloudclaw-setup-${name}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  writeVercelLink(tempDir, projectInfo);

  let dbVars: Record<string, string> = {};

  if (memoryBackend === "postgres") {
    const dbResult = await provisionDatabase(tempDir);
    if (!dbResult.success) {
      clack.log.error("Database provisioning failed. Rolling back Vercel project.");
      await deleteVercelProject(projectInfo);
      rmSync(tempDir, { recursive: true, force: true });
      process.exit(1);
    }
    dbVars = dbResult.dbVars;
  } else {
    clack.log.info(chalk.dim(`Skipping database (memory backend: ${memoryBackend})`));
  }

  // Redis for state store
  const redisResult = await provisionRedis(tempDir);
  rmSync(tempDir, { recursive: true, force: true });

  // ============================================================
  // Phase 2: Build instance + deploy
  // ============================================================

  const config = buildConfig(name, preset.id, preset.agent, agentConfigJson, {
    memoryBackend,
    activeDuration,
    cronSecret,
    nextAuthSecret,
    webhookSecret,
  });

  const dir = await createInstance(name, config);

  // Write the Vercel project link
  writeVercelLink(dir, projectInfo);

  // Patch vercel.json with plan-aware cron schedule
  patchVercelJson(dir, limits.heartbeatCron);

  // Disable Vercel Deployment Protection
  await disableDeploymentProtection(dir);

  // Derive env vars from config + merge provisioned vars
  const cloudclawEnv = toEnvVars(config);
  const allEnvVars: Record<string, string> = {
    ...cloudclawEnv,
    ...dbVars,
    ...(redisResult.success ? redisResult.redisVars : {}),
    CLOUDCLAW_INSTANCE_NAME: name,
  };

  // Persist all env vars to Vercel project
  await persistEnvVarsToProject(dir, allEnvVars);

  // Deploy
  const url = await deployToVercel(dir, allEnvVars);
  saveDeployedUrl(name, url);

  // Start sandbox
  clack.log.step("Starting sandbox...");
  if (cronSecret) {
    try {
      const res = await fetch(`${url}/api/cron/heartbeat?restart=true`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const result = await res.json() as Record<string, unknown>;
      clack.log.success(`Sandbox: ${result.action ?? "ok"}`);
    } catch {
      clack.log.warn("Could not start sandbox — it will start on first message.");
    }
  }

  // Success
  const botToken = allEnvVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken);
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

  clack.intro(chalk.bold.cyan(`Redeploying: ${name}`));
  clack.log.info(`Preset: ${meta.preset} | App: ${meta.appVersion}`);
  if (meta.deployedUrl) {
    clack.log.info(`Last deployed to: ${meta.deployedUrl}`);
  }

  // Check prerequisites
  clack.log.step("Checking prerequisites...");
  await checkPrerequisites();

  // Detect tier
  const { limits } = await detectAndPrintTier();

  // Upgrade instance
  await upgradeInstance(name);

  // Patch vercel.json
  patchVercelJson(dir, limits.heartbeatCron);

  // Read config and derive env vars
  const config = readConfig(name);
  if (!config) {
    clack.log.error(`No cloudclaw.json found for instance "${name}".`);
    process.exit(1);
  }
  const cloudclawEnv = toEnvVars(config);

  // Persist env vars
  await persistEnvVarsToProject(dir, cloudclawEnv);

  // Deploy
  const url = await deployToVercel(dir, cloudclawEnv);
  saveDeployedUrl(name, url);

  // Restart sandbox
  clack.log.step("Restarting sandbox...");
  const cronSecret = cloudclawEnv["CLOUDCLAW_CRON_SECRET"];
  if (cronSecret) {
    try {
      const res = await fetch(`${url}/api/cron/heartbeat?restart=true`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const result = await res.json() as Record<string, unknown>;
      clack.log.success(`Sandbox: ${result.action ?? "ok"}`);
    } catch (err) {
      clack.log.warn("Could not restart sandbox — it will start on first message.");
      clack.log.info(chalk.dim(`${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // Success
  const botToken = cloudclawEnv["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  printSuccess(name, url, botToken ?? null);
}

function printSuccess(
  name: string,
  url: string,
  botToken: string | null,
): void {
  clack.log.success(chalk.bold.green("Deployment successful!"));
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

  clack.outro("Done!");
}
