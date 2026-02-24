import { SandboxLifecycleManager } from "@cloudclaw/runtime";
import { registerWakeHooks, teardownWakeHooks } from "@cloudclaw/channel";

export function setupLifecycleHooks(): void {
  SandboxLifecycleManager.setHooks({
    onSandboxStarted: () => teardownWakeHooks(),
    onSandboxStopped: (baseUrl) => (baseUrl ? registerWakeHooks(baseUrl) : Promise.resolve()),
  });
}
