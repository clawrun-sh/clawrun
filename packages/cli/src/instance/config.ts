import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloudClawConfigSchema, type ClawRunConfig } from "@clawrun/runtime";
export { cloudClawConfigSchema };
import { generateSecret } from "@clawrun/auth";
export { generateSecret };
import { getChannelSecretDefinitions } from "@clawrun/channel";
import { instanceDir } from "./paths.js";

const SCHEMA_URL = "https://clawrun.sh/schema.json";
const CONFIG_FILENAME = "clawrun.json";

// Re-export the shared type and provide a stricter variant for CLI use
// (CLI configs always have secrets populated).
export type { ClawRunConfig };
export type ClawRunConfigWithSecrets = ClawRunConfig & {
  secrets: NonNullable<ClawRunConfig["secrets"]>;
};

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
    resources?: { vcpus: number };
    cronSecret: string;
    jwtSecret: string;
    webhookSecrets?: Record<string, string>;
    sandboxSecret: string;
    provider?: string;
    bundlePaths?: string[];
  },
): ClawRunConfigWithSecrets {
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
      bundlePaths: options.bundlePaths,
    },
    sandbox: {
      activeDuration: options.activeDuration,
      cronKeepAliveWindow: options.cronKeepAliveWindow,
      cronWakeLeadTime: options.cronWakeLeadTime,
      resources: options.resources,
    },
    secrets: {
      cronSecret: options.cronSecret,
      jwtSecret: options.jwtSecret,
      webhookSecrets: options.webhookSecrets,
      sandboxSecret: options.sandboxSecret,
    },
  }) as ClawRunConfigWithSecrets;
}

// --- Env var derivation ---

/** Derive ClawRun env vars from a structured config (for .env / Vercel).
 *  Channel env vars (bot tokens, etc.) are NOT included — the caller
 *  extracts those separately via extractChannelEnvVars(). */
export function toEnvVars(config: ClawRunConfigWithSecrets): Record<string, string> {
  const vars: Record<string, string> = {};

  // Core secrets
  vars["CLAWRUN_CRON_SECRET"] = config.secrets.cronSecret;
  vars["CLAWRUN_JWT_SECRET"] = config.secrets.jwtSecret;
  vars["CLAWRUN_SANDBOX_SECRET"] = config.secrets.sandboxSecret;

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

/** Return the path to clawrun.json for a given instance. */
export function configPath(name: string): string {
  return join(instanceDir(name), CONFIG_FILENAME);
}

/** Read and validate clawrun.json for an instance. Returns null if not found. */
export function readConfig(name: string): ClawRunConfigWithSecrets | null {
  const path = configPath(name);
  if (!existsSync(path)) return null;

  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const result = cloudClawConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(
      `Invalid clawrun.json for "${name}":\n${issues}\n` +
        `Re-run "clawrun deploy ${name}" to regenerate it.`,
    );
  }

  return result.data as ClawRunConfigWithSecrets;
}

/** Write clawrun.json for an instance. */
export function writeConfig(name: string, config: ClawRunConfig): void {
  const path = configPath(name);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}
