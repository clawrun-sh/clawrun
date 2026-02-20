/** Channels CloudClaw supports */
export type ChannelId = "telegram" | "discord" | "slack";

export interface ChannelDefinition {
  id: ChannelId;
  name: string;
  /** Can this channel send a webhook to wake the sandbox? */
  supportsWebhookWake: boolean;
  /** Env var key for the channel's bot/API token */
  tokenEnvVar: string;
}

export const CHANNELS: Record<ChannelId, ChannelDefinition> = {
  telegram: {
    id: "telegram",
    name: "Telegram",
    supportsWebhookWake: true,
    tokenEnvVar: "CLOUDCLAW_TELEGRAM_BOT_TOKEN",
  },
  discord: {
    id: "discord",
    name: "Discord",
    supportsWebhookWake: true,
    tokenEnvVar: "CLOUDCLAW_DISCORD_BOT_TOKEN",
  },
  slack: {
    id: "slack",
    name: "Slack",
    supportsWebhookWake: true,
    tokenEnvVar: "CLOUDCLAW_SLACK_BOT_TOKEN",
  },
};

/** Channel is configured (token present) and supports webhook-based wake */
export function canWake(channelId: ChannelId): boolean {
  const def = CHANNELS[channelId];
  return def.supportsWebhookWake && !!process.env[def.tokenEnvVar];
}

/** Any configured channel can wake the sandbox */
export function hasAnyWakeChannel(): boolean {
  return Object.values(CHANNELS).some((ch) => canWake(ch.id));
}
