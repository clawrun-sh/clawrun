import { setupLifecycleHooks } from "@clawrun/server/setup";
import { registerAgent, getRuntimeConfig } from "@clawrun/runtime";
import { createAgent } from "@clawrun/agent";

export function register() {
  const { agent } = getRuntimeConfig();
  const instance = createAgent(agent.name);
  registerAgent(agent.name, instance);
  setupLifecycleHooks();
}
