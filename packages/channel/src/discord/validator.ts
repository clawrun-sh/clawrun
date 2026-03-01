import type { ChannelValidator } from "../types.js";

const DISCORD_API = "https://discord.com/api/v10";

export const validator: ChannelValidator = {
  channelId: "discord",

  async validate(fields) {
    const token = fields.bot_token;
    if (!token) return { ok: false, message: "Bot token is required" };

    const headers = { Authorization: `Bot ${token}` };
    const signal = AbortSignal.timeout(10_000);

    // Validate token and fetch bot name
    const userResp = await fetch(`${DISCORD_API}/users/@me`, { headers, signal });
    if (!userResp.ok) return { ok: false, message: "Connection failed — check your token" };
    const userData = await userResp.json();
    const botName = userData?.username ?? "unknown";

    // Fetch application_id and public_key (verify_key) from the same token
    const appResp = await fetch(`${DISCORD_API}/applications/@me`, { headers, signal });
    if (!appResp.ok) {
      // Token works but can't fetch app info — non-fatal, wake hooks just won't work
      return {
        ok: true,
        message: `Connected as ${botName} (could not fetch app info for wake hooks)`,
      };
    }
    const appData = await appResp.json();
    const applicationId = appData?.id as string | undefined;
    const publicKey = appData?.verify_key as string | undefined;

    const enrichedFields: Record<string, string> = {};
    if (applicationId) enrichedFields.application_id = applicationId;
    if (publicKey) enrichedFields.public_key = publicKey;

    return { ok: true, message: `Connected as ${botName}`, enrichedFields };
  },
};
