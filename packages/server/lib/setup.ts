import { SandboxLifecycleManager } from "@clawrun/runtime";
import { registerWakeHooks, teardownWakeHooks } from "@clawrun/channel";

export function setupLifecycleHooks(): void {
  SandboxLifecycleManager.setHooks({
    onSandboxStarted: () => teardownWakeHooks(),
    onSandboxStopped: (baseUrl) => (baseUrl ? registerWakeHooks(baseUrl) : Promise.resolve()),
  });
}
