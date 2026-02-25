import type { ClawRunConfig } from "../instance/config.js";
import { instanceDeployDir } from "../instance/index.js";
import { getPlatformProvider } from "../platform/index.js";
import type { SandboxClient } from "./types.js";
import { VercelSandboxClient } from "./vercel.js";

export type { SandboxClient, SandboxEntry, ExecResult } from "./types.js";

const clientFactories: Record<string, (instance: string, config: ClawRunConfig) => SandboxClient> =
  {
    vercel: (instance) => {
      const dir = instanceDeployDir(instance);
      const platform = getPlatformProvider("vercel");
      const handle = platform.readProjectLink(dir);
      if (!handle) {
        throw new Error(
          `No project link found for instance "${instance}". ` +
            `Re-run "clawrun deploy ${instance}" to fix this.`,
        );
      }
      return new VercelSandboxClient({ projectId: handle.projectId, orgId: handle.orgId });
    },
  };

/**
 * Create a SandboxClient for the given instance based on its configured provider.
 */
export function createSandboxClient(instance: string, config: ClawRunConfig): SandboxClient {
  const { provider } = config.instance;

  const factory = clientFactories[provider];
  if (!factory) {
    const known = Object.keys(clientFactories).join(", ") || "(none)";
    throw new Error(`Unsupported sandbox provider: "${provider}". Available: ${known}`);
  }

  return factory(instance, config);
}
