import type { ChannelValidator } from "../types.js";

// POST https://api.dingtalk.com/v1.0/gateway/connections/open
export const validator: ChannelValidator = {
  channelId: "dingtalk",

  async validate(fields) {
    const clientId = fields.client_id;
    const clientSecret = fields.client_secret;
    if (!clientId || !clientSecret)
      return { ok: false, message: "Client ID and Secret are required" };

    const resp = await fetch("https://api.dingtalk.com/v1.0/gateway/connections/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { ok: false, message: "Connection failed — check your credentials" };

    return { ok: true, message: "DingTalk credentials verified" };
  },
};
