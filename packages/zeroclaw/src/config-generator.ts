import type { AgentEnv, ChannelConfig } from "./adapter/types.js";

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tomlString(value: string): string {
  return `"${escapeTomlString(value)}"`;
}

export function generateDaemonToml(
  env: AgentEnv,
  channels: ChannelConfig,
  options?: { databaseUrl?: string; memoryBackend?: string },
): string {
  const lines: string[] = [];

  lines.push(`api_key = ${tomlString(env.llmApiKey)}`);
  lines.push(`default_provider = ${tomlString(env.llmProvider)}`);
  lines.push(`default_model = ${tomlString(env.llmModel)}`);
  lines.push("");

  // Gateway config for daemon mode
  lines.push("[gateway]");
  lines.push("port = 3000");
  lines.push('host = "0.0.0.0"');
  lines.push("require_pairing = false");
  lines.push("allow_public_bind = true");
  lines.push("");

  // Autonomy
  lines.push("[autonomy]");
  lines.push('level = "full"');
  lines.push("require_approval_for_medium_risk = false");
  lines.push("workspace_only = true");
  lines.push("");

  // Memory
  lines.push("[memory]");
  const backend = options?.memoryBackend ?? (options?.databaseUrl ? "postgres" : "sqlite");
  lines.push(`backend = ${tomlString(backend)}`);
  lines.push("auto_save = true");
  if (backend === "postgres" && options?.databaseUrl) {
    lines.push(`postgres_url = ${tomlString(options.databaseUrl)}`);
  }
  lines.push("");

  // Channels
  if (channels.telegram) {
    lines.push("[channels_config.telegram]");
    lines.push(`bot_token = ${tomlString(channels.telegram.botToken)}`);
    const users = channels.telegram.allowedUsers ?? ["*"];
    lines.push(`allowed_users = [${users.map(tomlString).join(", ")}]`);
    lines.push("");
  }

  if (channels.discord) {
    lines.push("[channels_config.discord]");
    lines.push(`bot_token = ${tomlString(channels.discord.botToken)}`);
    lines.push("");
  }

  if (channels.slack) {
    lines.push("[channels_config.slack]");
    lines.push(`bot_token = ${tomlString(channels.slack.botToken)}`);
    if (channels.slack.appToken) {
      lines.push(`app_token = ${tomlString(channels.slack.appToken)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
