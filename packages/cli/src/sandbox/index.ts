import type { ClawRunConfig } from "../instance/config.js";
import { instanceDeployDir } from "../instance/index.js";
import { getPlatformProvider } from "../platform/index.js";
import { getProvider } from "@clawrun/provider";
import type { SandboxClient } from "./types.js";
import { ProviderSandboxClient } from "./client.js";

export type { SandboxClient, SandboxEntry, ExecResult } from "./types.js";

const clientFactories: Record<string, (instance: string, config: ClawRunConfig) => SandboxClient> =
  {
    vercel: (instance) => {
      const dir = instanceDeployDir(instance);
      const provider = getProvider("vercel", { projectDir: dir });
      const platform = getPlatformProvider("vercel");
      return new ProviderSandboxClient(provider, dir, platform);
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
