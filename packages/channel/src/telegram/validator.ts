import type { ChannelValidator } from "../types.js";

// GET https://api.telegram.org/bot{token}/getMe → result.username
export const validator: ChannelValidator = {
  channelId: "telegram",

  async validate(fields) {
    const token = fields.bot_token;
    if (!token) return { ok: false, message: "Bot token is required" };

    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { ok: false, message: "Connection failed — check your token" };

    const data = await resp.json();
    const botName = data?.result?.username ?? "unknown";
    return { ok: true, message: `Connected as @${botName}` };
  },
};
