import chalk from "chalk";

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

  // Step 2: Delete any stale webhook, then register fresh
  const webhookUrl = `${deployUrl}/api/webhook/telegram`;
  console.log(chalk.dim(`  Registering webhook: ${webhookUrl}`));

  try {
    // Always delete first to clear any stale secret_token
    await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
    });

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

    console.log(chalk.green("  Webhook registered!"));
  } catch {
    console.log(chalk.yellow("  Could not register webhook."));
    return result;
  }

  // Step 4: Verify webhook was set correctly
  try {
    const verifyRes = await fetch(`${TELEGRAM_API}${botToken}/getWebhookInfo`);
    const verifyData = (await verifyRes.json()) as TelegramResponse<WebhookInfo>;

    if (verifyData.ok && verifyData.result) {
      const info = verifyData.result;
      if (info.url === webhookUrl) {
        console.log(chalk.green(`  Verified: webhook pointing to ${info.url}`));
        result.webhookSet = true;
      } else {
        console.log(chalk.yellow(`  Warning: webhook URL mismatch. Expected ${webhookUrl}, got ${info.url}`));
      }
    }
  } catch {
    // Non-fatal — registration likely succeeded
    result.webhookSet = true;
  }

  return result;
}

export async function teardownTelegramWebhook(botToken: string): Promise<void> {
  console.log(chalk.dim("  Removing Telegram webhook for daemon mode..."));
  try {
    await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    console.log(chalk.green("  Webhook removed — daemon will use long-polling."));
  } catch {
    console.log(chalk.yellow("  Could not remove webhook — daemon may still work."));
  }
}
