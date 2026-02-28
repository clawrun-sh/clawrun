import type { ChannelValidator } from "../types.js";

// GET {homeserver}/_matrix/client/v3/account/whoami with Bearer token
export const validator: ChannelValidator = {
  channelId: "matrix",

  async validate(fields) {
    const homeserver = fields.homeserver?.replace(/\/+$/, "");
    const token = fields.access_token;
    if (!homeserver) return { ok: false, message: "Homeserver URL is required" };
    if (!token) return { ok: false, message: "Access token is required" };

    const resp = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok)
      return { ok: false, message: "Connection failed — check homeserver URL and token" };

    const data = await resp.json();
    const userId = data?.user_id ?? "";
    return { ok: true, message: userId ? `Verified as ${userId}` : "Connection verified" };
  },
};
