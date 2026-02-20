import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { instanceDir } from "./paths.js";

const SCHEMA_URL = "https://cloudclaw.sh/schema.json";
const CONFIG_FILENAME = "cloudclaw.json";

export interface CloudClawConfig {
  $schema?: string;
  instance: {
    name: string;
    preset: string;
    agent: string;
    deployedUrl?: string;
  };
  llm: {
    provider: string;
    apiKey: string;
    model: string;
  };
  memory: {
    backend: string;
  };
  sandbox: {
    activeDuration: number; // minutes
  };
  channels: {
    telegram?: {
      botToken: string;
      webhookSecret: string;
    };
    discord?: {
      botToken: string;
    };
    slack?: {
      botToken: string;
      appToken?: string;
    };
  };
  secrets: {
    cronSecret: string;
    nextAuthSecret: string;
  };
  redis?: {
    url: string;
    token: string;
    readOnlyToken?: string;
    kvUrl?: string;
  };
}

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

  // Redis / KV
  if (envVars["KV_REST_API_URL"]) {
    config.redis = {
      url: envVars["KV_REST_API_URL"],
      token: envVars["KV_REST_API_TOKEN"] ?? "",
      readOnlyToken: envVars["KV_REST_API_READ_ONLY_TOKEN"] || undefined,
      kvUrl: envVars["KV_URL"] || undefined,
    };
  }

  return config;
}

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

  // Redis / KV
  if (config.redis) {
    vars["KV_REST_API_URL"] = config.redis.url;
    vars["KV_REST_API_TOKEN"] = config.redis.token;
    if (config.redis.readOnlyToken) {
      vars["KV_REST_API_READ_ONLY_TOKEN"] = config.redis.readOnlyToken;
    }
    if (config.redis.kvUrl) {
      vars["KV_URL"] = config.redis.kvUrl;
    }
  }

  return vars;
}

/** Return the path to cloudclaw.json for a given instance. */
export function configPath(name: string): string {
  return join(instanceDir(name), CONFIG_FILENAME);
}

/** Read cloudclaw.json for an instance. Returns null if not found. */
export function readConfig(name: string): CloudClawConfig | null {
  const path = configPath(name);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CloudClawConfig;
  } catch {
    return null;
  }
}

/** Write cloudclaw.json for an instance. */
export function writeConfig(name: string, config: CloudClawConfig): void {
  const path = configPath(name);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}
