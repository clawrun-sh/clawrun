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

/**
 * Convert the full ZeroClaw config JSON (from napi getSavedConfig) to TOML format
 * for writing into the sandbox. Injects gateway overrides for daemon mode.
 */
export function generateDaemonTomlFromJson(configJson: string): string {
  const cfg = JSON.parse(configJson) as Record<string, unknown>;
  const lines: string[] = [];

  // Top-level scalar fields
  for (const [key, value] of Object.entries(cfg)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue; // handled as sections below
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }
  lines.push("");

  // Override gateway for daemon mode (CloudClaw sandbox)
  lines.push("[gateway]");
  lines.push("port = 3000");
  lines.push('host = "0.0.0.0"');
  lines.push("require_pairing = false");
  lines.push("allow_public_bind = true");
  lines.push("");

  // Override autonomy for sandbox
  lines.push("[autonomy]");
  lines.push('level = "full"');
  lines.push("require_approval_for_medium_risk = false");
  lines.push("workspace_only = true");
  lines.push("");

  // Emit remaining object sections (memory, channels_config, etc.)
  for (const [key, value] of Object.entries(cfg)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== "object") continue;
    if (key === "gateway" || key === "autonomy") continue; // already overridden
    emitTomlSection(lines, key, value as Record<string, unknown>);
  }

  return lines.join("\n");
}

function formatTomlValue(value: unknown): string {
  if (typeof value === "string") return `"${escapeTomlString(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => formatTomlValue(v));
    return `[${items.join(", ")}]`;
  }
  return `"${escapeTomlString(String(value))}"`;
}

function emitTomlSection(
  lines: string[],
  prefix: string,
  obj: Record<string, unknown>,
): void {
  const scalars: [string, unknown][] = [];
  const nested: [string, Record<string, unknown>][] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      nested.push([key, value as Record<string, unknown>]);
    } else {
      scalars.push([key, value]);
    }
  }

  if (scalars.length > 0) {
    lines.push(`[${prefix}]`);
    for (const [key, value] of scalars) {
      lines.push(`${key} = ${formatTomlValue(value)}`);
    }
    lines.push("");
  }

  for (const [key, value] of nested) {
    emitTomlSection(lines, `${prefix}.${key}`, value);
  }
}
