import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupLifecycleHooks, initializeWakeHookAdapters } from "@/lib/setup";
import { registerAgent, getRuntimeConfig } from "@clawrun/runtime";
import { createAgent } from "@clawrun/agent";

export async function register() {
  // Load clawrun.json to determine which agent/provider to register and
  // which platform env vars to check for the base URL.
  const raw = JSON.parse(readFileSync(join(process.cwd(), "clawrun.json"), "utf-8"));

  // Register agent + provider from clawrun.json before any createAgent() calls.
  const agentName: string | undefined = raw.agent?.name;
  const providerName: string | undefined = raw.instance?.provider;
  if (agentName) await import(`@clawrun/agent-${agentName}/register`);
  if (providerName) await import(`@clawrun/provider-${providerName}/register`);

  // Resolve CLAWRUN_BASE_URL from platform env vars if not explicitly set.
  // This must run before getRuntimeConfig() caches its result.
  if (!process.env.CLAWRUN_BASE_URL) {
    const urlVars: string[] = raw.instance?.platformUrlEnvVars ?? [];
    for (const varName of urlVars) {
      const value = process.env[varName];
      if (value) {
        process.env.CLAWRUN_BASE_URL = value.startsWith("http") ? value : `https://${value}`;
        break;
      }
    }
  }

  const config = getRuntimeConfig();
  const instance = createAgent(config.agent.name);
  registerAgent(config.agent.name, instance);

  // Read agent channel config and initialize wake hook adapters
  initializeWakeHookAdapters(instance, config);

  setupLifecycleHooks();
}
