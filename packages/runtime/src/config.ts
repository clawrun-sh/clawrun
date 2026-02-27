import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cloudClawConfigSchema, type ClawRunConfig } from "./schema.js";

export interface RuntimeConfig {
  instance: { name: string; provider: string; baseUrl?: string; sandboxRoot: string };
  agent: {
    name: string;
    config: string;
    bundlePaths: string[];
  };
  sandbox: {
    activeDuration: number;
    cronKeepAliveWindow: number;
    cronWakeLeadTime: number;
    resources: { vcpus: number; memory: number };
    networkPolicy: ClawRunConfig["sandbox"]["networkPolicy"];
  };
}

let cached: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(join(process.cwd(), "clawrun.json"), "utf-8"));
  const parsed = cloudClawConfigSchema.parse(raw);
  cached = {
    instance: {
      name: parsed.instance.name,
      provider: parsed.instance.provider,
      baseUrl: parsed.instance.deployedUrl ?? process.env.CLAWRUN_BASE_URL,
      sandboxRoot: parsed.instance.sandboxRoot,
    },
    agent: {
      name: parsed.agent.name,
      config: parsed.agent.config,
      bundlePaths: parsed.agent.bundlePaths,
    },
    sandbox: {
      activeDuration: parsed.sandbox.activeDuration,
      cronKeepAliveWindow: parsed.sandbox.cronKeepAliveWindow,
      cronWakeLeadTime: parsed.sandbox.cronWakeLeadTime,
      resources: {
        vcpus: parsed.sandbox.resources.vcpus,
        memory: parsed.sandbox.resources.vcpus * 2048,
      },
      networkPolicy: parsed.sandbox.networkPolicy,
    },
  };
  return cached;
}
