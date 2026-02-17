import { resolve } from "node:path";
import chalk from "chalk";
import { getPreset, listPresets } from "../presets/index.js";
import { collectEnvVars } from "../deploy/env.js";
import { checkPrerequisites, scaffoldApp, deployToVercel } from "../deploy/vercel.js";
import { buildAgentBinary } from "../deploy/binary.js";
import { setupDatabase } from "../deploy/database.js";
import { setupTelegram } from "../deploy/telegram.js";

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

export async function deployCommand(
  presetId: string,
  options: { yes?: boolean; dir?: string }
): Promise<void> {
  printBanner();

  // Resolve preset
  const preset = getPreset(presetId);
  if (!preset) {
    const available = listPresets()
      .map((p) => p.id)
      .join(", ");
    console.error(
      chalk.red(`Unknown preset: "${presetId}". Available: ${available}`)
    );
    process.exit(1);
  }

  console.log(chalk.bold(`Deploying preset: ${preset.name}`));
  console.log(chalk.dim(`  ${preset.description}\n`));

  // Check prerequisites
  console.log(chalk.bold("Checking prerequisites..."));
  await checkPrerequisites();

  // Collect env vars
  const envVars = await collectEnvVars(preset, options.yes ?? false);

  // Scaffold app
  const targetDir = resolve(options.dir ?? `cloudclaw-${preset.id}`);
  await scaffoldApp(targetDir, envVars, options.yes ?? false);

  // Build agent binary via Docker
  await buildAgentBinary(targetDir);

  // Deploy
  let url = await deployToVercel(targetDir, envVars);

  // Setup database (may redeploy, returning updated URL)
  const redeployUrl = await setupDatabase(targetDir, envVars);
  if (redeployUrl) {
    url = redeployUrl;
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
  console.log(chalk.bold.green("\nDeployment successful!\n"));
  console.log(`  ${chalk.bold("URL:")} ${chalk.cyan(url)}`);
  console.log(`  ${chalk.bold("Health:")} ${chalk.cyan(`${url}/api/health`)}`);

  if (botUsername) {
    console.log(
      `\n  ${chalk.bold("Telegram:")} ${chalk.cyan(`https://t.me/${botUsername}`)}`
    );
    console.log(
      chalk.dim(
        `\n  Your agent is live! Message @${botUsername} on Telegram to start chatting.`
      )
    );
  } else if (botToken) {
    console.log(
      chalk.dim(
        "\n  Next step: Message your Telegram bot to start chatting with your agent."
      )
    );
  }

  console.log();
}
