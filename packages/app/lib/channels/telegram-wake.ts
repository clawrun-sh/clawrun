const TELEGRAM_API = "https://api.telegram.org/bot";

function getWebhookUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) throw new Error("VERCEL_PROJECT_PRODUCTION_URL not set");
  return `https://${host}/api/v1/webhook/telegram`;
}

export async function registerTelegramWakeWebhook(): Promise<void> {
  const token = process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const secret = process.env.CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[CloudClaw] CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET not set — skipping webhook registration");
    return;
  }

  await fetch(`${TELEGRAM_API}${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: getWebhookUrl(),
      secret_token: secret,
      allowed_updates: ["message"],
    }),
  });
}

export async function deleteTelegramWakeWebhook(): Promise<void> {
  const token = process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`${TELEGRAM_API}${token}/deleteWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drop_pending_updates: false }),
  });
}
