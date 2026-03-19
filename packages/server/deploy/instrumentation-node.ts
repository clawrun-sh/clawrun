import { setupLifecycleHooks, initializeWakeHookAdapters } from "@/lib/setup";
import { registerAgent, getRuntimeConfig } from "@clawrun/runtime";
import { createAgent } from "@clawrun/agent";

// Register agent + provider factories. Static import strings (not template
// literals) so Next.js file tracing can resolve packages and transitive deps.
// Add a new branch here when a new agent or provider is implemented.
await import("@clawrun/agent-zeroclaw/register");
await import("@clawrun/provider-vercel/register");

const config = getRuntimeConfig();
const instance = createAgent(config.agent.name);
registerAgent(config.agent.name, instance);

initializeWakeHookAdapters(instance, config);
setupLifecycleHooks();
