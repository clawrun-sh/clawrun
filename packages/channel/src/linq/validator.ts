import type { ChannelValidator } from "../types.js";

// GET https://api.linqapp.com/api/partner/v3/phonenumbers with Bearer token
export const validator: ChannelValidator = {
  channelId: "linq",

  async validate(fields) {
    const token = fields.api_token;
    if (!token) return { ok: false, message: "API token is required" };

    const resp = await fetch("https://api.linqapp.com/api/partner/v3/phonenumbers", {
      headers: { Authorization: `Bearer ${token.trim()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { ok: false, message: "Connection failed — check API token" };

    return { ok: true, message: "Connected to Linq API" };
  },
};
