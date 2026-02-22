import type { CloudClawConfig } from "../instance/config.js";
import { instanceDir } from "../instance/index.js";
import { getPlatformProvider } from "../platform/index.js";
import type { SandboxClient } from "./types.js";
import { VercelSandboxClient } from "./vercel.js";

export type { SandboxClient, SandboxEntry, ExecResult } from "./types.js";

/**
 * Create a SandboxClient for the given instance based on its configured provider.
 */
export function createSandboxClient(
  instance: string,
  config: CloudClawConfig,
): SandboxClient {
  const { provider } = config.instance;
  if (!provider) {
    throw new Error(
      `Instance "${instance}" has no provider configured. ` +
      `Re-run "cloudclaw deploy ${instance}" to fix this.`,
    );
  }

  switch (provider) {
    case "vercel": {
      const dir = instanceDir(instance);
      const platform = getPlatformProvider("vercel");
      const handle = platform.readProjectLink(dir);
      if (!handle) {
        throw new Error(
          `No project link found for instance "${instance}". ` +
          `Re-run "cloudclaw deploy ${instance}" to fix this.`,
        );
      }
      return new VercelSandboxClient({ projectId: handle.projectId, orgId: handle.orgId });
    }
    default:
      throw new Error(`Unsupported sandbox provider: "${provider}"`);
  }
}
