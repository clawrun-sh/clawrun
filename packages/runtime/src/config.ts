import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clawRunConfigSchema, type ClawRunConfig } from "./schema.js";
import type { ProviderId } from "@clawrun/provider";

export interface RuntimeConfig {
  instance: { name: string; provider: ProviderId; baseUrl: string; sandboxRoot: string };
  agent: {
    name: string;
    config: string;
    bundlePaths: string[];
    tools: string[];
  };
  sandbox: {
    activeDuration: number;
    cronKeepAliveWindow: number;
    cronWakeLeadTime: number;
    resources: { vcpus: number; memory: number };
    networkPolicy: ClawRunConfig["sandbox"]["networkPolicy"];
  };
  secrets?: {
    webhookSecrets?: Record<string, string>;
  };
}

const WEBHOOK_SECRET_PREFIX = "CLAWRUN_WEBHOOK_SECRET_";

/** Scan process.env for CLAWRUN_WEBHOOK_SECRET_<CHANNEL> vars. */
function readWebhookSecretsFromEnv(): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(WEBHOOK_SECRET_PREFIX) && value) {
      const channelId = key.slice(WEBHOOK_SECRET_PREFIX.length).toLowerCase();
      secrets[channelId] = value;
    }
  }
  return secrets;
}

/** Default MB of RAM per vCPU when memory is not explicitly configured. */
const DEFAULT_MB_PER_VCPU = 2048;

let cached: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(join(process.cwd(), "clawrun.json"), "utf-8"));
  const parsed = clawRunConfigSchema.parse(raw);
  cached = {
    instance: {
      name: parsed.instance.name,
      provider: parsed.instance.provider,
      baseUrl: parsed.instance.deployedUrl,
      sandboxRoot: parsed.instance.sandboxRoot,
    },
    agent: {
      name: parsed.agent.name,
      config: parsed.agent.config,
      bundlePaths: parsed.agent.bundlePaths,
      tools: parsed.agent.tools,
    },
    sandbox: {
      activeDuration: parsed.sandbox.activeDuration,
      cronKeepAliveWindow: parsed.sandbox.cronKeepAliveWindow,
      cronWakeLeadTime: parsed.sandbox.cronWakeLeadTime,
      resources: {
        vcpus: parsed.sandbox.resources.vcpus,
        memory:
          parsed.sandbox.resources.memory ?? parsed.sandbox.resources.vcpus * DEFAULT_MB_PER_VCPU,
      },
      networkPolicy: parsed.sandbox.networkPolicy,
    },
    secrets: {
      webhookSecrets: readWebhookSecretsFromEnv(),
    },
  };
  return cached;
}
