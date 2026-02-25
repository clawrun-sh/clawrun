import { SandboxLifecycleManager } from "@clawrun/runtime";
import { registerWakeHooks, teardownWakeHooks } from "@clawrun/channel";

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
