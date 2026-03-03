import { readParsedConfig, schemaDefaults } from "zeroclaw";
import type { ZeroClawConfig } from "zeroclaw";
import { deepmergeCustom } from "deepmerge-ts";
import * as TOML from "@iarna/toml";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderSetup, AgentSetupData, ChannelInfo } from "@clawrun/agent";
import { agentSetupDataSchema } from "@clawrun/agent";

/**
 * Coerce a string value to the appropriate JS type for TOML serialization.
 * @iarna/toml serializes JS types correctly: number → TOML integer,
 * boolean → TOML boolean, string → TOML string. ZeroClaw's Rust structs
 * expect matching TOML types (bool, u16, etc.), not strings.
 */
function coerceTomlValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value) && value.length < 10) return parseInt(value, 10);
  return value;
}

/**
 * ClawRun overrides on top of ZeroClaw's schema defaults.
 * Only fields where we diverge from zeroclaw's defaults.
 */
const CLAWRUN_OVERRIDES: Partial<ZeroClawConfig> = {
  default_temperature: 0.7,
  autonomy: {
    level: "full",
    workspace_only: true,
    allowed_commands: [
      // Read-only inspection
      "ls",
      "cat",
      "head",
      "tail",
      "wc",
      "grep",
      "find",
      "echo",
      "pwd",
      "date",
      "which",
      "file",
      // Text processing / stream filters
      "jq",
      "sort",
      "uniq",
      "cut",
      "tr",
      "sed",
      "awk",
      "diff",
      "patch",
      "tee",
      "xargs",
      // Path utilities
      "basename",
      "dirname",
      "realpath",
      "env",
      "printenv",
      // Version control
      "git",
      // Package managers
      "npm",
      "npx",
      "pnpm",
      "yarn",
      "pip",
      "pip3",
      "cargo",
      // Runtimes
      "node",
      "python",
      "python3",
      // File operations (no permission changes)
      "mkdir",
      "cp",
      "mv",
      "rm",
      "touch",
      "ln",
      // Archive
      "tar",
      "gzip",
      "gunzip",
      "zip",
      "unzip",
      // Build
      "make",
    ],
    max_actions_per_hour: 500,
    max_cost_per_day_cents: 5000,
    require_approval_for_medium_risk: false,
    block_high_risk_commands: false,
  },
  memory: { backend: "sqlite", auto_save: true },
  browser: {
    enabled: true,
    backend: "agent_browser",
    allowed_domains: ["*"],
    browser_open: "disable",
  },
};

/** Deep merge where config arrays win outright (no union/dedup). */
const deepmerge = deepmergeCustom({
  mergeArrays(values) {
    return values[values.length - 1];
  },
});

/**
 * Write agent-specific config (provider, channels, daemon defaults) to config.toml.
 * Preserves existing user customizations.
 */
export function writeSetupConfig(
  agentDir: string,
  data: AgentSetupData,
  supportedChannels: ChannelInfo[],
): void {
  agentSetupDataSchema.parse(data);

  const configPath = join(agentDir, "config.toml");

  // Preserve existing config fields (personality, autonomy, etc.)
  let existing: Partial<ZeroClawConfig> = {};
  try {
    existing = TOML.parse(readFileSync(configPath, "utf-8")) as unknown as Partial<ZeroClawConfig>;
  } catch {
    // No existing config — start fresh
  }

  // Deep merge: zeroclaw schema defaults → ClawRun overrides → existing user config → wizard values.
  // Each layer wins over the previous for conflicting keys.
  const base = deepmerge(schemaDefaults, CLAWRUN_OVERRIDES, existing) as Partial<ZeroClawConfig>;

  // Wizard values + forced overrides — always applied on top.
  // security.otp.enabled is forced false (OTP is unusable in daemon mode).
  const config = deepmerge(base, {
    api_key: data.provider.apiKey,
    default_provider: data.provider.provider,
    default_model: data.provider.model,
    ...(data.provider.apiUrl ? { api_url: data.provider.apiUrl } : {}),
    security: { otp: { enabled: false } },
  } as Partial<ZeroClawConfig>) as Partial<ZeroClawConfig>;

  // Merge channels into channels_config.
  if (Object.keys(data.channels).length > 0) {
    const cc: Record<string, unknown> = {
      ...((config.channels_config as Record<string, unknown>) ?? {}),
    };
    if (cc.cli === undefined) cc.cli = true;
    for (const [channelId, fields] of Object.entries(data.channels)) {
      const section: Record<string, unknown> = {
        ...((cc[channelId] as Record<string, unknown>) ?? {}),
      };
      const channelInfo = supportedChannels.find((c) => c.id === channelId);
      for (const [key, value] of Object.entries(fields)) {
        const fieldDef = channelInfo?.setupFields.find((f) => f.name === key);

        if (fieldDef?.type === "list") {
          section[key] = value
            ? String(value)
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
            : [];
        } else if (!value && !fieldDef?.required) {
          if (fieldDef?.default !== undefined) {
            section[key] = coerceTomlValue(fieldDef.default);
          }
          continue;
        } else {
          section[key] = coerceTomlValue(value);
        }
      }
      cc[channelId] = section;
    }
    config.channels_config = cc as ZeroClawConfig["channels_config"];
  }

  writeFileSync(configPath, TOML.stringify(config as TOML.JsonMap));
}

/**
 * Read existing setup from agent config dir. Null if no config.
 */
export function readSetup(agentDir: string): {
  provider?: Partial<ProviderSetup>;
  channels?: Record<string, Record<string, string>>;
} | null {
  if (!existsSync(join(agentDir, "config.toml"))) return null;

  try {
    const parsed = readParsedConfig(agentDir);

    const provider: Partial<ProviderSetup> = {};
    if (parsed.default_provider) provider.provider = parsed.default_provider;
    if (parsed.api_key) provider.apiKey = parsed.api_key;
    if (parsed.default_model) provider.model = parsed.default_model;
    if (parsed.api_url) provider.apiUrl = parsed.api_url;

    const channels: Record<string, Record<string, string>> = {};
    const cc = parsed.channels_config;
    if (cc) {
      for (const [channelId, section] of Object.entries(cc)) {
        if (channelId === "cli" || !section || typeof section !== "object") continue;
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
          if (Array.isArray(value)) {
            fields[key] = value.map(String).join(", ");
          } else if (value != null) {
            fields[key] = String(value);
          }
        }
        channels[channelId] = fields;
      }
    }

    return { provider, channels };
  } catch {
    return null;
  }
}
