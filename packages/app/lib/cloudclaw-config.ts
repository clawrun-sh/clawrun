import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RuntimeConfig {
  instance: { name: string };
  agent: {
    name: string;
    config: string;
  };
  sandbox: {
    activeDuration: number;
    cronKeepAliveWindow: number;
    cronWakeLeadTime: number;
  };
}

let cached: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(join(process.cwd(), "cloudclaw.json"), "utf-8"));
  cached = {
    instance: { name: raw.instance?.name ?? "default" },
    agent: {
      name: raw.agent?.name ?? "zeroclaw",
      config: raw.agent?.config ?? "agent/config.toml",
    },
    sandbox: {
      activeDuration: raw.sandbox?.activeDuration ?? 600,
      cronKeepAliveWindow: raw.sandbox?.cronKeepAliveWindow ?? 900,
      cronWakeLeadTime: raw.sandbox?.cronWakeLeadTime ?? 60,
    },
  };
  return cached;
}
