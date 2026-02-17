import chalk from "chalk";
import { confirm } from "@inquirer/prompts";

const TELEGRAM_API = "https://api.telegram.org/bot";

interface TelegramResponse<T = unknown> {
  ok: boolean;
  description?: string;
  result?: T;
}

interface BotUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
}

export interface TelegramSetupResult {
  botUsername: string | null;
  webhookSet: boolean;
}

export async function setupTelegram(
  deployUrl: string,
  botToken: string,
  webhookSecret: string,
): Promise<TelegramSetupResult> {
  console.log(chalk.cyan("\nSetting up Telegram bot...\n"));

  const result: TelegramSetupResult = {
    botUsername: null,
    webhookSet: false,
  };

  // Step 1: Verify bot token
  console.log(chalk.dim("  Verifying bot token..."));

  try {
    const meRes = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
    const meData = (await meRes.json()) as TelegramResponse<BotUser>;

    if (!meData.ok || !meData.result) {
      console.log(
        chalk.yellow(`  Bot token verification failed: ${meData.description ?? "unknown error"}`),
      );
      return result;
    }

    result.botUsername = meData.result.username ?? null;
    console.log(
      chalk.green(`  Bot verified: @${result.botUsername ?? meData.result.first_name}`),
    );
  } catch {
    console.log(chalk.yellow("  Could not verify bot token — skipping Telegram setup."));
    return result;
  }

  // Step 2: Check for existing webhook
  console.log(chalk.dim("  Checking for existing webhook..."));

  try {
    const infoRes = await fetch(`${TELEGRAM_API}${botToken}/getWebhookInfo`);
    const infoData = (await infoRes.json()) as TelegramResponse<WebhookInfo>;

    if (infoData.ok && infoData.result?.url) {
      const existingUrl = infoData.result.url;
      console.log(chalk.yellow(`  Existing webhook found: ${existingUrl}`));

      const shouldDelete = await confirm({
        message: "An existing webhook is registered for this bot. Delete it and register the new one?",
        default: true,
      });

      if (!shouldDelete) {
        console.log(chalk.yellow("  Keeping existing webhook. Skipping registration."));
        return result;
      }

      // Delete existing webhook
      console.log(chalk.dim("  Deleting existing webhook..."));
      const deleteRes = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`);
      const deleteData = (await deleteRes.json()) as TelegramResponse;

      if (deleteData.ok) {
        console.log(chalk.green("  Existing webhook deleted."));
      } else {
        console.log(
          chalk.yellow(`  Could not delete webhook: ${deleteData.description ?? "unknown error"}`),
        );
        return result;
      }
    } else {
      console.log(chalk.dim("  No existing webhook."));
    }
  } catch {
    console.log(chalk.dim("  Could not check webhook info — continuing."));
  }

  // Step 3: Register new webhook
  const webhookUrl = `${deployUrl}/api/webhook/telegram`;
  console.log(chalk.dim(`  Registering webhook: ${webhookUrl}`));

  try {
    const webhookRes = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
      }),
    });
    const webhookData = (await webhookRes.json()) as TelegramResponse;

    if (!webhookData.ok) {
      console.log(
        chalk.yellow(`  Webhook registration failed: ${webhookData.description ?? "unknown error"}`),
      );
      return result;
    }

    result.webhookSet = true;
    console.log(chalk.green("  Webhook registered!"));
  } catch {
    console.log(chalk.yellow("  Could not register webhook."));
    return result;
  }

  return result;
}
