import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getChannelSecretDefinitions } from "@cloudclaw/channel";

/** Generate a 256-bit base64url secret. */
export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}
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
    provider: z.string().default("vercel"),
    deployedUrl: z.string().optional(),
  }),
  agent: z.object({
    name: z.string(),          // e.g. "zeroclaw"
    config: z.string().default("agent/config.toml"),
  }),
  sandbox: z.object({
    activeDuration: z.number().default(600),        // seconds
    cronKeepAliveWindow: z.number().default(900),   // seconds
    cronWakeLeadTime: z.number().default(60),       // seconds
  }),
  secrets: z.object({
    cronSecret: z.string(),
    nextAuthSecret: z.string(),
    /** Per-channel webhook secrets, keyed by channel ID (e.g. "telegram"). */
    webhookSecrets: z.record(z.string(), z.string()).optional(),
    sandboxSecret: z.string(),
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
    activeDuration?: number;
    cronKeepAliveWindow?: number;
    cronWakeLeadTime?: number;
    cronSecret: string;
    nextAuthSecret: string;
    webhookSecrets?: Record<string, string>;
    sandboxSecret: string;
    provider?: string;
  },
): CloudClawConfig {
  return cloudClawConfigSchema.parse({
    $schema: SCHEMA_URL,
    instance: {
      name,
      preset,
      provider: options.provider,
    },
    agent: {
      name: agentName,
      config: options.agentConfigPath,
    },
    sandbox: {
      activeDuration: options.activeDuration,
      cronKeepAliveWindow: options.cronKeepAliveWindow,
      cronWakeLeadTime: options.cronWakeLeadTime,
    },
    secrets: {
      cronSecret: options.cronSecret,
      nextAuthSecret: options.nextAuthSecret,
      webhookSecrets: options.webhookSecrets,
      sandboxSecret: options.sandboxSecret,
    },
  });
}

// --- Env var derivation ---

/** Derive CloudClaw env vars from a structured config (for .env / Vercel).
 *  Channel env vars (bot tokens, etc.) are NOT included — the caller
 *  extracts those separately via extractChannelEnvVars(). */
export function toEnvVars(
  config: CloudClawConfig,
): Record<string, string> {
  const vars: Record<string, string> = {};

  // Core secrets
  vars["CLOUDCLAW_CRON_SECRET"] = config.secrets.cronSecret;
  vars["CLOUDCLAW_NEXTAUTH_SECRET"] = config.secrets.nextAuthSecret;
  vars["CLOUDCLAW_SANDBOX_SECRET"] = config.secrets.sandboxSecret;

  // Per-channel webhook secrets
  if (config.secrets.webhookSecrets) {
    // Map per-channel secrets to their env var names
    for (const def of getChannelSecretDefinitions()) {
      const secret = config.secrets.webhookSecrets[def.channelId];
      if (secret) {
        vars[def.envVar] = secret;
      }
    }
  }

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

