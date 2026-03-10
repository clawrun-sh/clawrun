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
 * ClawRun defaults on top of ZeroClaw's schema defaults.
 * On fresh deploy these are the config values. On redeploy, user edits
 * in the existing config.toml take priority (existing config wins).
 */
const CLAWRUN_DEFAULTS: Partial<ZeroClawConfig> = {
  default_temperature: 0.7,
  autonomy: {
    level: "full",
    workspace_only: true,
    max_actions_per_hour: 500,
    max_cost_per_day_cents: 5000,
    require_approval_for_medium_risk: false,
    block_high_risk_commands: false,
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
      // Tool-specific commands (agent-browser, gh, skills, firecrawl, etc.) are
      // injected dynamically from SKILL.md allowed-tools frontmatter:
      // - At boot: lifecycle.ts parses built-in Tool.skillContent + workspace skills
      // - At runtime: skills wrapper patches config after `skills add`
    ],
    // All tools available from all channels (web UI, Telegram, etc.).
    // ZeroClaw defaults exclude browser/shell for non-CLI channels.
    non_cli_excluded_tools: [],
    // ZeroClaw defaults forbid /home, /tmp, /var, etc. — designed for local machines.
    // In a sandbox (isolated microVM), the workspace is under /home and browser
    // temp data goes to /tmp, so we clear this.
    forbidden_paths: [],
  },
  memory: { backend: "sqlite", auto_save: true },
  agent: {
    // Limit history to prevent context overflow from large tool results
    // (e.g. browser snapshots can be 60K+ chars per page visit).
    max_history_messages: 20,
    max_tool_iterations: 50,
    parallel_tools: true,
    session: {
      backend: "sqlite",
      strategy: "per-sender",
      ttl_seconds: 86400,
      max_messages: 30,
    },
  },
  browser: {
    enabled: true,
    backend: "agent_browser",
    allowed_domains: ["*"],
    browser_open: "disable",
  },
  // Lightweight URL fetching — preferred over browser for simple page reads.
  web_fetch: {
    enabled: true,
    allowed_domains: ["*"],
    max_response_size: 500_000,
    timeout_secs: 30,
  },
  // Web search via DuckDuckGo — free, no API key required.
  web_search: {
    enabled: true,
    provider: "duckduckgo",
  },
  // Raw HTTP client for API interactions (REST calls, webhooks, JSON APIs).
  http_request: {
    enabled: true,
    allowed_domains: ["*"],
    max_response_size: 1_000_000,
    timeout_secs: 30,
  },
  // Proactive research phase — agent gathers info before answering when needed.
  research: {
    enabled: true,
    trigger: "keywords",
  },
  security: { otp: { enabled: false } },
  // Full mode inlines entire SKILL.md into the system prompt so smaller models
  // (e.g. mistral-small) reliably activate skills and follow their instructions.
  skills: { prompt_injection_mode: "full" },
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

  // Deep merge chain:
  //   schemaDefaults → ClawRun defaults → existing user config → wizard values
  // ClawRun defaults set sane values for the sandbox environment.
  // Existing user config wins on redeploy (user edits take priority).
  // Wizard values (provider, model) are always applied last.
  const config = deepmerge(schemaDefaults, CLAWRUN_DEFAULTS, existing, {
    api_key: data.provider.apiKey,
    default_provider: data.provider.provider,
    default_model: data.provider.model,
    ...(data.provider.apiUrl ? { api_url: data.provider.apiUrl } : {}),
  } as Partial<ZeroClawConfig>) as Partial<ZeroClawConfig>;

  // Write cost config if provided
  if (data.cost) {
    if (data.cost.enabled) {
      const costSection: Record<string, unknown> = {
        enabled: true,
        daily_limit_usd: data.cost.dailyLimitUsd,
        monthly_limit_usd: data.cost.monthlyLimitUsd,
        enforcement: { mode: "warn" },
        prices: {
          [data.provider.model]: {
            input: data.cost.inputPerMillion,
            output: data.cost.outputPerMillion,
          },
        },
      };
      // Preserve any existing price entries for other models
      const existingCost = (existing as Record<string, unknown>).cost as
        | Record<string, unknown>
        | undefined;
      if (existingCost?.prices && typeof existingCost.prices === "object") {
        costSection.prices = {
          ...(existingCost.prices as Record<string, unknown>),
          [data.provider.model]: {
            input: data.cost.inputPerMillion,
            output: data.cost.outputPerMillion,
          },
        };
      }
      (config as Record<string, unknown>).cost = costSection;
    } else {
      (config as Record<string, unknown>).cost = { enabled: false };
    }
  }

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
  cost?: {
    enabled?: boolean;
    inputPerMillion?: number;
    outputPerMillion?: number;
    dailyLimitUsd?: number;
    monthlyLimitUsd?: number;
  };
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

    // Read cost config
    let cost:
      | {
          enabled?: boolean;
          inputPerMillion?: number;
          outputPerMillion?: number;
          dailyLimitUsd?: number;
          monthlyLimitUsd?: number;
        }
      | undefined;

    const costConfig = parsed.cost;
    if (costConfig) {
      cost = {
        enabled: costConfig.enabled,
        dailyLimitUsd: costConfig.daily_limit_usd,
        monthlyLimitUsd: costConfig.monthly_limit_usd,
      };
      // Read model pricing for the current model
      if (costConfig.prices && parsed.default_model) {
        const modelPrice = costConfig.prices[parsed.default_model];
        if (modelPrice) {
          cost.inputPerMillion = modelPrice.input;
          cost.outputPerMillion = modelPrice.output;
        }
      }
    }

    return { provider, channels, cost };
  } catch {
    return null;
  }
}
