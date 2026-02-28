import type { ChannelValidator } from "../types.js";

// POST https://bots.qq.com/app/getAppAccessToken
export const validator: ChannelValidator = {
  channelId: "qq",

  async validate(fields) {
    const appId = fields.app_id;
    const appSecret = fields.app_secret;
    if (!appId || !appSecret) return { ok: false, message: "App ID and Secret are required" };

    const resp = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { ok: false, message: "Connection failed — check your credentials" };

    const data = await resp.json();
    if (!data?.access_token) {
      return { ok: false, message: "Auth error — check your credentials" };
    }

    return { ok: true, message: "QQ Bot credentials verified" };
  },
};
