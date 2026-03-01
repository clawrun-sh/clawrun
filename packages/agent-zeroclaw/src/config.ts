import { readParsedConfig, configDefaults } from "zeroclaw";
import type { ZeroClawConfig } from "zeroclaw";
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
 * Autonomy overrides for daemon mode — intentionally differ from ZeroClaw's
 * interactive defaults for unattended sandbox operation.
 *
 * Schema defaults (interactive): level=supervised, 20 actions/hr, $5/day,
 *   13 allowed commands, forbidden_paths=[/etc, /root, ...],
 *   block_high_risk=true, require_approval=true, non_cli_excluded_tools=[21 tools]
 *
 * Daemon overrides: full autonomy, expanded commands, relaxed limits,
 *   no tool exclusions — the sandbox is isolated and the operator is absent.
 */
const DAEMON_AUTONOMY_OVERRIDES: ZeroClawConfig["autonomy"] = {
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
  forbidden_paths: [],
  max_actions_per_hour: 500,
  max_cost_per_day_cents: 5000,
  require_approval_for_medium_risk: false,
  block_high_risk_commands: false,
  non_cli_excluded_tools: [],
};

/** Deploy-time defaults for daemon mode. Existing user config takes precedence. */
const DEPLOY_DEFAULTS = {
  memory: { backend: "sqlite" },
  browser: {
    enabled: true,
    backend: "agent_browser",
    allowed_domains: ["*"],
  },
} satisfies Partial<ZeroClawConfig>;

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

  const config: Partial<ZeroClawConfig> = {
    ...configDefaults,
    default_temperature: 0.7,
    ...existing,

    // Wizard outputs (always written)
    api_key: data.provider.apiKey,
    default_provider: data.provider.provider,
    default_model: data.provider.model,
    ...(data.provider.apiUrl ? { api_url: data.provider.apiUrl } : {}),

    autonomy: {
      ...(configDefaults.autonomy ?? {}),
      ...DAEMON_AUTONOMY_OVERRIDES,
      ...(existing.autonomy ?? {}),
    },

    security: {
      ...(configDefaults.security ?? {}),
      ...(existing.security ?? {}),
      otp: {
        ...(configDefaults.security?.otp ?? {}),
        ...(existing.security?.otp ?? {}),
        enabled: false,
      },
    },

    memory: {
      ...(configDefaults.memory ?? {}),
      ...DEPLOY_DEFAULTS.memory,
      ...(existing.memory ?? {}),
    },

    browser: {
      ...(configDefaults.browser ?? {}),
      ...DEPLOY_DEFAULTS.browser,
      ...(existing.browser ?? {}),
    },
  };

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
