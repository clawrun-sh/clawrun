import type { ChannelValidator } from "../types.js";

// GET https://discord.com/api/v10/users/@me with Bot token header
export const validator: ChannelValidator = {
  channelId: "discord",

  async validate(fields) {
    const token = fields.bot_token;
    if (!token) return { ok: false, message: "Bot token is required" };

    const resp = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { ok: false, message: "Connection failed — check your token" };

    const data = await resp.json();
    const botName = data?.username ?? "unknown";
    return { ok: true, message: `Connected as ${botName}` };
  },
};
