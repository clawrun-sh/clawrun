import type { ChannelValidator } from "../types.js";

// GET https://graph.facebook.com/v18.0/{phone_number_id} with Bearer token
export const validator: ChannelValidator = {
  channelId: "whatsapp",

  async validate(fields) {
    const token = fields.access_token;
    const phoneId = fields.phone_number_id;
    if (!token) return { ok: false, message: "Access token is required" };
    if (!phoneId) return { ok: false, message: "Phone number ID is required" };

    const resp = await fetch(`https://graph.facebook.com/v18.0/${phoneId.trim()}`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok)
      return { ok: false, message: "Connection failed — check access token and phone number ID" };

    return { ok: true, message: "Connected to WhatsApp API" };
  },
};
