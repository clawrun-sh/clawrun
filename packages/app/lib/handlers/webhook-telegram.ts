export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { Bot, webhookCallback } from "grammy";
import { runAgent } from "../sandbox/runner";

let _bot: Bot | null = null;

function getBot() {
  if (_bot) return _bot;

  const token = process.env.CLOUDCLAW_TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("CLOUDCLAW_TELEGRAM_BOT_TOKEN environment variable not found.");
  }

  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hello! I'm your CloudClaw agent powered by ZeroClaw. Send me a message and I'll respond.",
    );
  });

  bot.on("message:text", async (ctx) => {
    const message = ctx.message.text;

    try {
      const response = await runAgent(message);

      if (response.success) {
        await ctx.reply(response.message.slice(0, 4096));
      } else {
        console.error("[CloudClaw] Agent error:", response.error ?? response.message);
        const errorDetail = response.error
          ? `Error: ${response.error.slice(0, 200)}`
          : "Unknown error";
        await ctx.reply(
          `Something went wrong running the agent.\n\n${errorDetail}`,
        );
      }
    } catch (err) {
      console.error("[CloudClaw] Webhook handler error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.reply(
        `Internal error: ${errMsg.slice(0, 300)}`,
      );
    }
  });

  _bot = bot;
  return bot;
}

export async function POST(req: Request) {
  const bot = getBot();
  const secretToken = process.env.CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET;
  const handler = webhookCallback(bot, "std/http", { secretToken });
  return handler(req);
}
