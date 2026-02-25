import { setupLifecycleHooks } from "@clawrun/server/setup";
import { registerAgent, getRuntimeConfig } from "@clawrun/runtime";
import { createAgent } from "@clawrun/agent";

export function register() {
  // Resolve CLAWRUN_BASE_URL from platform env vars if not explicitly set.
  // This must run before getRuntimeConfig() caches its result.
  if (!process.env.CLAWRUN_BASE_URL) {
    const platformUrl =
      process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
    if (platformUrl) {
      process.env.CLAWRUN_BASE_URL = `https://${platformUrl}`;
    }
  }

  const { agent } = getRuntimeConfig();
  const instance = createAgent(agent.name);
  registerAgent(agent.name, instance);
  setupLifecycleHooks();
}
