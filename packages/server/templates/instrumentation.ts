import { setupLifecycleHooks, initializeWakeHookAdapters } from "@clawrun/server/setup";
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

  const config = getRuntimeConfig();
  const instance = createAgent(config.agent.name);
  registerAgent(config.agent.name, instance);

  // Read agent channel config and initialize wake hook adapters
  initializeWakeHookAdapters(instance, config);

  setupLifecycleHooks();
}
