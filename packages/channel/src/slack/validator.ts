import type { ChannelValidator } from "../types.js";

// GET https://slack.com/api/auth.test with Bearer token
// Slack returns 200 even on auth errors; check data.ok
export const validator: ChannelValidator = {
  channelId: "slack",

  async validate(fields) {
    const token = fields.bot_token;
    if (!token) return { ok: false, message: "Bot token is required" };

    const resp = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { ok: false, message: "Connection failed — check your token" };

    const data = await resp.json();
    const apiOk = data?.ok === true;
    if (!apiOk) {
      const err = data?.error ?? "unknown error";
      return { ok: false, message: `Slack error: ${err}` };
    }
    const team = data?.team ?? "unknown";
    return { ok: true, message: `Connected to workspace: ${team}` };
  },
};
