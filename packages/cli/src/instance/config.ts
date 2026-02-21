import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { instanceDir } from "./paths.js";

const SCHEMA_URL = "https://cloudclaw.sh/schema.json";
const CONFIG_FILENAME = "cloudclaw.json";

// --- Zod schema ---

const stateSchema = z.object({
  url: z.string(),
  token: z.string(),
  readOnlyToken: z.string().optional(),
  kvUrl: z.string().optional(),
});

export const cloudClawConfigSchema = z.object({
  $schema: z.string().optional(),
  instance: z.object({
    name: z.string(),
    preset: z.string(),
    provider: z.string(),
    deployedUrl: z.string().optional(),
  }),
  agent: z.object({
    name: z.string(),          // e.g. "zeroclaw"
    config: z.string(),        // relative path: "zeroclaw/config.toml"
  }),
  memory: z.object({
    backend: z.string(),
  }),
  sandbox: z.object({
    activeDuration: z.number(),
  }),
  secrets: z.object({
    cronSecret: z.string(),
    nextAuthSecret: z.string(),
    webhookSecret: z.string(),
  }),
  state: stateSchema.optional(),
});

export type CloudClawConfig = z.infer<typeof cloudClawConfigSchema>;

// --- Builder ---

/** Build a structured config from instance metadata. */
export function buildConfig(
  name: string,
  preset: string,
  agentName: string,
  options: {
    agentConfigPath?: string;
    memoryBackend?: string;
    activeDuration?: number;
    cronSecret: string;
    nextAuthSecret: string;
    webhookSecret: string;
  },
): CloudClawConfig {
  return {
    $schema: SCHEMA_URL,
    instance: {
      name,
      preset,
      provider: "vercel",
    },
    agent: {
      name: agentName,
      config: options.agentConfigPath ?? "zeroclaw/config.toml",
    },
    memory: {
      backend: options.memoryBackend ?? "sqlite",
    },
    sandbox: {
      activeDuration: options.activeDuration ?? 5,
    },
    secrets: {
      cronSecret: options.cronSecret,
      nextAuthSecret: options.nextAuthSecret,
      webhookSecret: options.webhookSecret,
    },
  };
}

// --- Env var derivation ---

/** Derive flat env vars from a structured config + agent config JSON (for .env / Vercel). */
export function toEnvVars(
  config: CloudClawConfig,
  agentConfigJson: string,
): Record<string, string> {
  const vars: Record<string, string> = {};

  // Instance
  vars["CLOUDCLAW_INSTANCE_NAME"] = config.instance.name;

  // Extract LLM/channel info from agent config JSON
  try {
    const agentCfg = JSON.parse(agentConfigJson);

    // LLM
    if (agentCfg.default_provider) vars["CLOUDCLAW_LLM_PROVIDER"] = agentCfg.default_provider;
    if (agentCfg.api_key) vars["CLOUDCLAW_LLM_API_KEY"] = agentCfg.api_key;
    if (agentCfg.default_model) vars["CLOUDCLAW_LLM_MODEL"] = agentCfg.default_model;

    // Telegram bot token (for webhook setup)
    if (agentCfg.channels_config?.telegram?.bot_token) {
      vars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"] = agentCfg.channels_config.telegram.bot_token;
    }
  } catch {
    // agentConfigJson might not be valid JSON yet during initial setup
  }

  // Full agent config as env var (sandbox uses this)
  vars["CLOUDCLAW_AGENT_CONFIG_JSON"] = agentConfigJson;

  // Memory
  vars["CLOUDCLAW_MEMORY_BACKEND"] = config.memory.backend;

  // Sandbox
  vars["CLOUDCLAW_SANDBOX_ACTIVE_DURATION"] = String(config.sandbox.activeDuration);

  // Secrets
  vars["CLOUDCLAW_CRON_SECRET"] = config.secrets.cronSecret;
  vars["CLOUDCLAW_NEXTAUTH_SECRET"] = config.secrets.nextAuthSecret;
  vars["CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET"] = config.secrets.webhookSecret;

  // State store
  if (config.state) {
    vars["KV_REST_API_URL"] = config.state.url;
    vars["KV_REST_API_TOKEN"] = config.state.token;
    if (config.state.readOnlyToken) {
      vars["KV_REST_API_READ_ONLY_TOKEN"] = config.state.readOnlyToken;
    }
    if (config.state.kvUrl) {
      vars["KV_URL"] = config.state.kvUrl;
    }
  }

  return vars;
}

// --- I/O ---

/** Return the path to cloudclaw.json for a given instance. */
export function configPath(name: string): string {
  return join(instanceDir(name), CONFIG_FILENAME);
}

/** Migrate old cloudclaw.json schema (agentConfig string + instance.agent) to new shape. */
function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  // Already new schema
  if (raw.agent && typeof raw.agent === "object") return raw;

  const instance = raw.instance as Record<string, unknown> | undefined;
  const agentName = instance?.agent as string | undefined;

  if (agentName || typeof raw.agentConfig === "string") {
    // Migrate: move agent name out of instance, replace agentConfig blob with path
    const migrated = { ...raw };
    migrated.agent = {
      name: agentName ?? "zeroclaw",
      config: "zeroclaw/config.toml",
    };

    // Clean up old fields
    if (instance) {
      const { agent: _, ...rest } = instance;
      migrated.instance = rest;
    }
    delete migrated.agentConfig;
    return migrated;
  }

  return raw;
}

/** Read and validate cloudclaw.json for an instance. Returns null if not found.
 *  Transparently migrates old schema (agentConfig string) to new shape. */
export function readConfig(name: string): CloudClawConfig | null {
  const path = configPath(name);
  if (!existsSync(path)) return null;

  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const migrated = migrateConfig(raw);
  const result = cloudClawConfigSchema.safeParse(migrated);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid cloudclaw.json for "${name}":\n${issues}\n` +
      `Re-run "cloudclaw deploy ${name}" to regenerate it.`,
    );
  }

  // Persist migration if shape changed
  if (migrated !== raw) {
    writeFileSync(path, JSON.stringify(result.data, null, 2) + "\n");
  }

  return result.data;
}

/** Write cloudclaw.json for an instance. */
export function writeConfig(name: string, config: CloudClawConfig): void {
  const path = configPath(name);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

/** Read agent config.toml via napi, returning JSON string.
 *  Sets ZEROCLAW_CONFIG_DIR so napi reads from the instance's zeroclaw/ dir.
 *
 *  If config.toml doesn't exist yet (old instance with inline agentConfig),
 *  bootstraps it from the old cloudclaw.json data before reading. */
export async function readAgentConfigJson(name: string): Promise<string> {
  const config = readConfig(name);
  if (!config) throw new Error(`No config for instance "${name}"`);

  const zcDir = join(instanceDir(name), "zeroclaw");
  const configFilePath = join(instanceDir(name), config.agent.config);

  // Migration: bootstrap config.toml from old inline agentConfig
  if (!existsSync(configFilePath)) {
    const rawPath = join(instanceDir(name), "cloudclaw.json");
    const rawJson = JSON.parse(readFileSync(rawPath, "utf-8"));

    if (typeof rawJson.agentConfig === "string") {
      // Old schema had the full config as JSON — write it via napi so it
      // produces a proper config.toml
      mkdirSync(zcDir, { recursive: true });
      const prev = process.env.ZEROCLAW_CONFIG_DIR;
      process.env.ZEROCLAW_CONFIG_DIR = zcDir;
      try {
        const napi = await import("zeroclaw-napi");
        // getSavedConfig will load_or_init, creating a default config.toml.
        // Then we can return the old agentConfig directly since it's already JSON.
        await napi.getSavedConfig();
      } finally {
        if (prev !== undefined) process.env.ZEROCLAW_CONFIG_DIR = prev;
        else delete process.env.ZEROCLAW_CONFIG_DIR;
      }
      // Return the original inline JSON — it's the authoritative data
      return rawJson.agentConfig;
    }

    throw new Error(`Agent config not found: ${configFilePath}`);
  }

  const prev = process.env.ZEROCLAW_CONFIG_DIR;
  process.env.ZEROCLAW_CONFIG_DIR = zcDir;
  try {
    const napi = await import("zeroclaw-napi");
    return await napi.getSavedConfig();
  } finally {
    if (prev !== undefined) process.env.ZEROCLAW_CONFIG_DIR = prev;
    else delete process.env.ZEROCLAW_CONFIG_DIR;
  }
}
