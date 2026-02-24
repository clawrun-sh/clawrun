import { setupLifecycleHooks } from "@cloudclaw/server/setup";
import { registerAgent, getRuntimeConfig } from "@cloudclaw/runtime";
import { createAgent } from "@cloudclaw/agent";

export function register() {
  const { agent } = getRuntimeConfig();
  const instance = createAgent(agent.name);
  registerAgent(agent.name, instance);
  setupLifecycleHooks();
}
