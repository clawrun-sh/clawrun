import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { instanceDir } from "./paths.js";

const SCHEMA_URL = "https://cloudclaw.sh/schema.json";
const CONFIG_FILENAME = "cloudclaw.json";

// --- Zod schema ---

const telegramChannelSchema = z.object({
  botToken: z.string(),
  webhookSecret: z.string(),
});

const discordChannelSchema = z.object({
  botToken: z.string(),
});

const slackChannelSchema = z.object({
  botToken: z.string(),
  appToken: z.string().optional(),
});

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
  llm: z.object({
    provider: z.string(),
    apiKey: z.string(),
    model: z.string(),
  }),
  memory: z.object({
    backend: z.string(),
  }),
  sandbox: z.object({
    activeDuration: z.number(),
  }),
  channels: z.object({
    telegram: telegramChannelSchema.optional(),
    discord: discordChannelSchema.optional(),
    slack: slackChannelSchema.optional(),
  }),
  secrets: z.object({
    cronSecret: z.string(),
    nextAuthSecret: z.string(),
  }),
  state: stateSchema.optional(),
});

export type CloudClawConfig = z.infer<typeof cloudClawConfigSchema>;

// --- Builder ---

/** Build a structured config from collected env vars + instance metadata. */
export function buildConfig(
  name: string,
  preset: string,
  agent: string,
  envVars: Record<string, string>,
): CloudClawConfig {
  const config: CloudClawConfig = {
    $schema: SCHEMA_URL,
    instance: {
      name,
      preset,
      agent,
      provider: "vercel",
    },
    llm: {
      provider: envVars["CLOUDCLAW_LLM_PROVIDER"] ?? "anthropic",
      apiKey: envVars["CLOUDCLAW_LLM_API_KEY"] ?? "",
      model: envVars["CLOUDCLAW_LLM_MODEL"] ?? "claude-sonnet-4-20250514",
    },
    memory: {
      backend: envVars["CLOUDCLAW_MEMORY_BACKEND"] ?? "sqlite",
    },
    sandbox: {
      activeDuration: parseInt(envVars["CLOUDCLAW_SANDBOX_ACTIVE_DURATION"] ?? "5", 10),
    },
    channels: {},
    secrets: {
      cronSecret: envVars["CLOUDCLAW_CRON_SECRET"] ?? "",
      nextAuthSecret: envVars["CLOUDCLAW_NEXTAUTH_SECRET"] ?? "",
    },
  };

  // Telegram
  if (envVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"]) {
    config.channels.telegram = {
      botToken: envVars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"],
      webhookSecret: envVars["CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET"] ?? "",
    };
  }

  // Discord
  if (envVars["CLOUDCLAW_DISCORD_BOT_TOKEN"]) {
    config.channels.discord = {
      botToken: envVars["CLOUDCLAW_DISCORD_BOT_TOKEN"],
    };
  }

  // Slack
  if (envVars["CLOUDCLAW_SLACK_BOT_TOKEN"]) {
    config.channels.slack = {
      botToken: envVars["CLOUDCLAW_SLACK_BOT_TOKEN"],
      appToken: envVars["CLOUDCLAW_SLACK_APP_TOKEN"] || undefined,
    };
  }

  // State store
  if (envVars["KV_REST_API_URL"]) {
    config.state = {
      url: envVars["KV_REST_API_URL"],
      token: envVars["KV_REST_API_TOKEN"] ?? "",
      readOnlyToken: envVars["KV_REST_API_READ_ONLY_TOKEN"] || undefined,
      kvUrl: envVars["KV_URL"] || undefined,
    };
  }

  return config;
}

// --- Env var derivation ---

/** Derive flat env vars from a structured config (for .env / Vercel). */
export function toEnvVars(config: CloudClawConfig): Record<string, string> {
  const vars: Record<string, string> = {};

  // Instance
  vars["CLOUDCLAW_INSTANCE_NAME"] = config.instance.name;

  // LLM
  vars["CLOUDCLAW_LLM_PROVIDER"] = config.llm.provider;
  vars["CLOUDCLAW_LLM_API_KEY"] = config.llm.apiKey;
  vars["CLOUDCLAW_LLM_MODEL"] = config.llm.model;

  // Memory
  vars["CLOUDCLAW_MEMORY_BACKEND"] = config.memory.backend;

  // Sandbox
  vars["CLOUDCLAW_SANDBOX_ACTIVE_DURATION"] = String(config.sandbox.activeDuration);

  // Channels
  if (config.channels.telegram) {
    vars["CLOUDCLAW_TELEGRAM_BOT_TOKEN"] = config.channels.telegram.botToken;
    vars["CLOUDCLAW_TELEGRAM_WEBHOOK_SECRET"] = config.channels.telegram.webhookSecret;
  }
  if (config.channels.discord) {
    vars["CLOUDCLAW_DISCORD_BOT_TOKEN"] = config.channels.discord.botToken;
  }
  if (config.channels.slack) {
    vars["CLOUDCLAW_SLACK_BOT_TOKEN"] = config.channels.slack.botToken;
    if (config.channels.slack.appToken) {
      vars["CLOUDCLAW_SLACK_APP_TOKEN"] = config.channels.slack.appToken;
    }
  }

  // Secrets
  vars["CLOUDCLAW_CRON_SECRET"] = config.secrets.cronSecret;
  vars["CLOUDCLAW_NEXTAUTH_SECRET"] = config.secrets.nextAuthSecret;

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
