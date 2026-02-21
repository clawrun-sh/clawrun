import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    agent: z.string(),
    provider: z.string(),
    deployedUrl: z.string().optional(),
  }),
  agentConfig: z.string(), // Full ZeroClaw config as JSON string (from napi getSavedConfig)
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

/** Build a structured config from ZeroClaw agent config + instance metadata. */
export function buildConfig(
  name: string,
  preset: string,
  agent: string,
  agentConfigJson: string,
  options: {
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
      agent,
      provider: "vercel",
    },
    agentConfig: agentConfigJson,
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

/** Derive flat env vars from a structured config (for .env / Vercel). */
export function toEnvVars(config: CloudClawConfig): Record<string, string> {
  const vars: Record<string, string> = {};

  // Instance
  vars["CLOUDCLAW_INSTANCE_NAME"] = config.instance.name;

  // Extract LLM/channel info from agentConfig for env vars
  try {
    const agentCfg = JSON.parse(config.agentConfig);

    // LLM
    if (agentCfg.default_provider) vars["CLOUDCLAW_LLM_PROVIDER"] = agentCfg.default_provider;
    if (agentCfg.api_key) vars["CLOUDCLAW_LLM_API_KEY"] = agentCfg.api_key;
    if (agentCfg.default_model) vars["CLOUDCLAW_LLM_MODEL"] = agentCfg.default_model;

    // Telegram bot token (for webhook setup)
    if (agentCfg.channels_config?.telegram?.bot_token) {
      vars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"] = agentCfg.channels_config.telegram.bot_token;
    }
  } catch {
    // agentConfig might not be valid JSON yet during initial setup
  }

  // Full agent config as env var (sandbox uses this)
  vars["CLOUDCLAW_AGENT_CONFIG_JSON"] = config.agentConfig;

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

/** Read and validate cloudclaw.json for an instance. Returns null if not found. */
export function readConfig(name: string): CloudClawConfig | null {
  const path = configPath(name);
  if (!existsSync(path)) return null;

  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const result = cloudClawConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid cloudclaw.json for "${name}":\n${issues}\n` +
      `Re-run "cloudclaw deploy ${name}" to regenerate it.`,
    );
  }

  return result.data;
}

/** Write cloudclaw.json for an instance. */
export function writeConfig(name: string, config: CloudClawConfig): void {
  const path = configPath(name);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}
