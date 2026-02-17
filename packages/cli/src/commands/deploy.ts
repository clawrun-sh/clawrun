import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { humanId } from "human-id";
import { ensureBinary } from "zeroclaw";
import { getPreset, listPresets } from "../presets/index.js";
import { collectEnvVars } from "../deploy/env.js";
import {
  checkPrerequisites,
  deployToVercel,
  disableDeploymentProtection,
  persistEnvVarsToProject,
} from "../deploy/vercel.js";
import { setupDatabase } from "../deploy/database.js";
import { setupTelegram } from "../deploy/telegram.js";
import {
  createInstance,
  instanceExists,
  getInstance,
  instanceDir,
  saveDeployedUrl,
  upgradeInstance,
} from "../instance/index.js";

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

  // Collect env vars
  const envVars = await collectEnvVars(preset, options.yes ?? false);

  // Create instance
  const dir = await createInstance(name, preset.id, preset.agent, envVars);

  // Build agent binary and copy to instance
  console.log(chalk.cyan("\nBuilding ZeroClaw agent binary...\n"));
  const binaryPath = await ensureBinary("linux-x64");
  const binDir = join(dir, "public", "bin");
  mkdirSync(binDir, { recursive: true });
  copyFileSync(binaryPath, join(binDir, "zeroclaw-linux-amd64"));
  console.log(chalk.green("  ZeroClaw binary ready."));

  // Initial deploy (creates the Vercel project)
  let url = await deployToVercel(dir, envVars);

  // Disable Vercel Deployment Protection (SSO) so webhooks can reach the app
  await disableDeploymentProtection(dir);

  // Persist env vars to Vercel project level (needed for runtime — --env only sets build-time vars)
  await persistEnvVarsToProject(dir, envVars);

  // Save URL to instance metadata
  saveDeployedUrl(name, url);

  // Setup database (may redeploy, returning updated URL)
  let redeployed = false;
  const redeployUrl = await setupDatabase(dir, envVars);
  if (redeployUrl) {
    url = redeployUrl;
    redeployed = true;
    saveDeployedUrl(name, url);
  }

  // If database setup didn't trigger a redeploy, we must redeploy now
  // so that project-level env vars are available at runtime
  if (!redeployed) {
    console.log(chalk.cyan("\nRedeploying with project-level env vars...\n"));
    url = await deployToVercel(dir, {});
    saveDeployedUrl(name, url);
  }

  // Setup Telegram webhook
  let botUsername: string | null = null;
  const botToken = envVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  const webhookSecret = envVars["CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET"];

  if (botToken && webhookSecret) {
    const telegramResult = await setupTelegram(url, botToken, webhookSecret);
    botUsername = telegramResult.botUsername;
  }

  // Success
  printSuccess(name, url, botUsername, botToken);
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

  // Upgrade instance (reinstall deps, reapply templates)
  await upgradeInstance(name);

  // Ensure binary is present
  console.log(chalk.cyan("\nEnsuring ZeroClaw agent binary...\n"));
  const binaryPath = await ensureBinary("linux-x64");
  const binDir = join(dir, "public", "bin");
  mkdirSync(binDir, { recursive: true });
  copyFileSync(binaryPath, join(binDir, "zeroclaw-linux-amd64"));
  console.log(chalk.green("  ZeroClaw binary ready."));

  // Deploy (env vars already persisted at project level from first deploy)
  const url = await deployToVercel(dir, {});

  // Save URL
  saveDeployedUrl(name, url);

  // Re-register Telegram webhook with the new deployment URL
  const envVars = readInstanceEnv(dir);
  let botUsername: string | null = null;
  const botToken = envVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"];
  const webhookSecret = envVars["CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET"];

  if (botToken && webhookSecret) {
    const telegramResult = await setupTelegram(url, botToken, webhookSecret);
    botUsername = telegramResult.botUsername;
  }

  // Success
  printSuccess(name, url, botUsername, botToken ?? null);
}

function printSuccess(
  name: string,
  url: string,
  botUsername: string | null,
  botToken: string | null,
): void {
  console.log(chalk.bold.green("\nDeployment successful!\n"));
  console.log(`  ${chalk.bold("Instance:")} ${chalk.cyan(name)}`);
  console.log(`  ${chalk.bold("URL:")} ${chalk.cyan(url)}`);
  console.log(`  ${chalk.bold("Health:")} ${chalk.cyan(`${url}/api/health`)}`);

  if (botUsername) {
    console.log(
      `\n  ${chalk.bold("Telegram:")} ${chalk.cyan(`https://t.me/${botUsername}`)}`,
    );
    console.log(
      chalk.dim(
        `\n  Your agent is live! Message @${botUsername} on Telegram to start chatting.`,
      ),
    );
  } else if (botToken) {
    console.log(
      chalk.dim(
        "\n  Next step: Message your Telegram bot to start chatting with your agent.",
      ),
    );
  }

  console.log();
}
