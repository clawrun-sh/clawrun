export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { SandboxLifecycleManager } from "../sandbox/lifecycle";
import {
  registerTelegramWakeWebhook,
  deleteTelegramWakeWebhook,
} from "../channels/telegram-wake";

/**
 * Toggle wake hooks based on sandbox state:
 * - running → delete webhook so ZeroClaw can long-poll Telegram
 * - sleeping/failed → register webhook so incoming messages trigger a wake
 */
async function registerWakeHooks(): Promise<void> {
  if (process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN) await registerTelegramWakeWebhook();
  // if (process.env.CLOUDCLAW_DISCORD_BOT_TOKEN) await registerDiscordWakeHook();
  // if (process.env.CLOUDCLAW_SLACK_BOT_TOKEN)   await registerSlackWakeHook();
}

async function teardownWakeHooks(): Promise<void> {
  if (process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN) await deleteTelegramWakeWebhook();
  // if (process.env.CLOUDCLAW_DISCORD_BOT_TOKEN) await deleteDiscordWakeHook();
  // if (process.env.CLOUDCLAW_SLACK_BOT_TOKEN)   await deleteSlackWakeHook();
}

export async function GET(req: Request) {
  // Verify cron secret — Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET ?? process.env.CLOUDCLAW_CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const url = new URL(req.url);
  const forceRestart = url.searchParams.get("restart") === "true";

  try {
    const manager = new SandboxLifecycleManager();
    const result = forceRestart
      ? await manager.forceRestart()
      : await manager.heartbeat();

    // Toggle wake hooks based on sandbox state
    if (result.action === "running") {
      await teardownWakeHooks();
    } else {
      await registerWakeHooks();
    }

    return NextResponse.json({ status: "ok", ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[CloudClaw] Heartbeat error:", error);
    return NextResponse.json(
      { status: "error", error },
      { status: 500 },
    );
  }
}
