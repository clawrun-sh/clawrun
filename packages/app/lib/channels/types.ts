/** Channels CloudClaw supports */
export type ChannelId = "telegram" | "discord" | "slack";

/** Whether a channel supports webhook-based wake */
export interface ChannelDefinition {
  id: ChannelId;
  name: string;
  /** Can this channel send a webhook to wake the sandbox? */
  alwaysOnEligible: boolean;
  /** Env var key for the channel's bot/API token */
  tokenEnvVar: string;
  /** Env var key for the always-on toggle */
  alwaysOnEnvVar: string;
}

export const CHANNELS: Record<ChannelId, ChannelDefinition> = {
  telegram: {
    id: "telegram",
    name: "Telegram",
    alwaysOnEligible: true,
    tokenEnvVar: "CLOUDCLAW_TELEGRAM_BOT_TOKEN",
    alwaysOnEnvVar: "CLOUDCLAW_TELEGRAM_ALWAYS_ON",
  },
  discord: {
    id: "discord",
    name: "Discord",
    alwaysOnEligible: true,
    tokenEnvVar: "CLOUDCLAW_DISCORD_BOT_TOKEN",
    alwaysOnEnvVar: "CLOUDCLAW_DISCORD_ALWAYS_ON",
  },
  slack: {
    id: "slack",
    name: "Slack",
    alwaysOnEligible: true,
    tokenEnvVar: "CLOUDCLAW_SLACK_BOT_TOKEN",
    alwaysOnEnvVar: "CLOUDCLAW_SLACK_ALWAYS_ON",
  },
};

/** Check if a specific channel has always-on enabled */
export function isAlwaysOn(channelId: ChannelId): boolean {
  const def = CHANNELS[channelId];
  return (
    !!process.env[def.tokenEnvVar] &&
    process.env[def.alwaysOnEnvVar] === "true"
  );
}

/** Check if ANY channel has always-on enabled */
export function hasAnyAlwaysOn(): boolean {
  return Object.values(CHANNELS).some(
    (ch) => ch.alwaysOnEligible && isAlwaysOn(ch.id),
  );
}

