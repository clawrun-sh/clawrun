import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clawRunConfigSchema, type ClawRunConfig } from "@clawrun/runtime";
export { clawRunConfigSchema };
import { generateSecret } from "@clawrun/auth";
export { generateSecret };
import type { ProviderId } from "@clawrun/provider";
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
    networkPolicy?: ClawRunConfig["sandbox"]["networkPolicy"];
    cronSecret: string;
    jwtSecret: string;
    webhookSecrets?: Record<string, string>;
    sandboxSecret: string;
    provider?: ProviderId;
    bundlePaths?: string[];
    configPaths?: string[];
    tools?: string[];
    serverExternalPackages?: string[];
    deployedUrl: string;
  },
): ClawRunConfigWithSecrets {
  return clawRunConfigSchema.parse({
    $schema: SCHEMA_URL,
    instance: {
      name,
      preset,
      provider: options.provider,
      deployedUrl: options.deployedUrl,
    },
    agent: {
      name: agentName,
      config: options.agentConfigPath,
      bundlePaths: options.bundlePaths,
      configPaths: options.configPaths,
      tools: options.tools,
    },
    sandbox: {
      activeDuration: options.activeDuration,
      cronKeepAliveWindow: options.cronKeepAliveWindow,
      cronWakeLeadTime: options.cronWakeLeadTime,
      resources: options.resources,
      networkPolicy: options.networkPolicy,
    },
    serverExternalPackages: options.serverExternalPackages,
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
 *  Secrets are env-var-only — they are stripped from the bundled clawrun.json
 *  so they never appear in the Vercel deployment source viewer. */
export function toEnvVars(config: ClawRunConfigWithSecrets): Record<string, string> {
  const vars: Record<string, string> = {};

  // Core secrets
  vars["CLAWRUN_CRON_SECRET"] = config.secrets.cronSecret;
  vars["CLAWRUN_JWT_SECRET"] = config.secrets.jwtSecret;
  vars["CLAWRUN_SANDBOX_SECRET"] = config.secrets.sandboxSecret;

  // Per-channel webhook secrets: CLAWRUN_WEBHOOK_SECRET_<CHANNEL>
  if (config.secrets.webhookSecrets) {
    for (const [channelId, secret] of Object.entries(config.secrets.webhookSecrets)) {
      vars[`CLAWRUN_WEBHOOK_SECRET_${channelId.toUpperCase()}`] = secret;
    }
  }

  // Base URL
  vars["CLAWRUN_BASE_URL"] = config.instance.deployedUrl;

  // State store
  if (config.state) {
    vars["REDIS_URL"] = config.state.redisUrl;
  }

  return vars;
}

// --- Sanitization ---

/**
 * Return a deploy-safe copy of a config with all secrets removed.
 *
 * Uses an allowlist of top-level keys — any new key added to the schema
 * must be explicitly listed here to be included in the deployment bundle.
 * This prevents accidental secret leakage if the schema grows.
 */
export function sanitizeConfig(config: ClawRunConfig): Omit<ClawRunConfig, "secrets" | "state"> {
  return {
    $schema: config.$schema,
    instance: config.instance,
    agent: config.agent,
    sandbox: config.sandbox,
    serverExternalPackages: config.serverExternalPackages,
  };
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
  const result = clawRunConfigSchema.safeParse(raw);

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
