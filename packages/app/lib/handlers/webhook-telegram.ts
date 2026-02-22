export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { Bot } from "grammy";
import { requireTelegramWebhookAuth } from "../auth";
import { deleteTelegramWakeWebhook } from "../channels/telegram-wake";
import { SandboxLifecycleManager } from "../sandbox/lifecycle";

let _bot: Bot | null = null;

function getBot() {
  if (_bot) return _bot;

  const token = process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("CLOUDCLAW_TELEGRAM_BOT_TOKEN environment variable not found.");
  }

  _bot = new Bot(token);
  return _bot;
}

/**
 * Telegram webhook handler — wake signal + sandbox trigger.
 *
 * On hobby tier (no per-minute cron), this webhook is the primary lifecycle
 * trigger. On paid tier, the heartbeat cron handles it.
 *
 * Flow:
 *   1. Deletes the webhook — Telegram stops delivering further messages
 *   2. Sends a "Waking up..." courtesy message to the user
 *   3. Calls heartbeat() to trigger sandbox creation (idempotent — safe
 *      even if the per-minute cron is also running on paid tier)
 *   4. Returns 503 — update stays unconfirmed in Telegram's queue
 *
 * ZeroClaw picks up the queued messages via getUpdates once it starts.
 */
export async function POST(req: Request) {
  // Gate on bot token — if Telegram is configured, the wake webhook should work
  // regardless of always-on mode. On hobby tier, this webhook is the primary
  // lifecycle trigger since there's no per-minute cron.
  if (!process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN) {
    return new Response("Telegram not configured", { status: 200 });
  }

  // Verify webhook secret (fail-closed — rejects if secret is not configured)
  const denied = requireTelegramWebhookAuth(req);
  if (denied) return denied;

  let update: Record<string, unknown>;
  try {
    update = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const message = update.message as Record<string, unknown> | undefined;
  if (!message) {
    return new Response(null, { status: 200 });
  }

  const chatId = (message.chat as Record<string, unknown>)?.id as
    | number
    | undefined;

  // Step 1: Delete webhook — Telegram stops sending messages.
  // Idempotent — safe if multiple in-flight requests call this concurrently.
  await deleteTelegramWakeWebhook();

  // Step 2: Send courtesy message.
  if (chatId) {
    const bot = getBot();
    try {
      await bot.api.sendMessage(chatId, "Waking up, one moment...");
    } catch {
      // Best-effort
    }
  }

  // Step 3: Start sandbox if not running (safe — wake() is idempotent).
  // On hobby tier this is the primary lifecycle trigger since there's no
  // per-minute cron. On paid tier the heartbeat cron handles it too, but
  // calling wake() here is harmless and makes wake-up faster.
  try {
    const manager = new SandboxLifecycleManager();
    await manager.wake();
  } catch (err) {
    console.error("[CloudClaw] Webhook-triggered wake failed:", err);
  }

  // Return 503: update stays unconfirmed in Telegram's queue.
  // ZeroClaw picks it up via getUpdates once the sandbox starts.
  return new Response(null, { status: 503 });
}
