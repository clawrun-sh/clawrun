import { ClawRunClient, readConfig, instanceDeployDir } from "@clawrun/sdk";
import type { ClawRunInstance, ClawRunConfigWithSecrets } from "@clawrun/sdk";

export interface InstanceConnection {
  instance: ClawRunInstance;
  config: ClawRunConfigWithSecrets;
}

/**
 * Create a ClawRunInstance from a local instance name.
 * Reads the config, extracts deployedUrl + jwtSecret, and connects via SDK.
 * Returns null if the instance is not fully deployed.
 */
export function connectInstance(name: string): InstanceConnection | null {
  const config = readConfig(name);
  if (!config) return null;

  const { deployedUrl } = config.instance;
  const { jwtSecret } = config.secrets;
  if (!jwtSecret) return null;

  const client = new ClawRunClient();
  const instance = client.connect(deployedUrl, jwtSecret, {
    provider: config.instance.provider,
    providerOptions: { projectDir: instanceDeployDir(name) },
  });

  return { instance, config };
}
