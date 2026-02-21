import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CloudClawConfig } from "../instance/config.js";
import { instanceDir } from "../instance/index.js";
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
      const projectJson = join(dir, ".vercel", "project.json");
      const { projectId, orgId } = JSON.parse(
        readFileSync(projectJson, "utf-8"),
      ) as { projectId: string; orgId: string };
      return new VercelSandboxClient({ projectId, orgId });
    }
    default:
      throw new Error(`Unsupported sandbox provider: "${provider}"`);
  }
}
