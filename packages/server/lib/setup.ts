import { join, dirname } from "node:path";
import { SandboxLifecycleManager, type RuntimeConfig } from "@clawrun/runtime";
import { registerWakeHooks, teardownWakeHooks, initializeAdapters } from "@clawrun/channel";
import type { Agent } from "@clawrun/agent";

export function setupLifecycleHooks(): void {
  SandboxLifecycleManager.setHooks({
    onSandboxStarted: () => teardownWakeHooks(),
    onSandboxStopped: (baseUrl) => {
      if (!baseUrl) {
        // Lifecycle manager already logs this — just skip the channel call.
        return Promise.resolve();
      }
      return registerWakeHooks(baseUrl);
    },
  });
}

export function initializeWakeHookAdapters(agent: Agent, config: RuntimeConfig): void {
  const agentDir = join(process.cwd(), dirname(config.agent.config));
  const setup = agent.readSetup(agentDir);
  const webhookSecrets = config.secrets?.webhookSecrets ?? {};
  initializeAdapters(setup?.channels ?? {}, webhookSecrets);
}
