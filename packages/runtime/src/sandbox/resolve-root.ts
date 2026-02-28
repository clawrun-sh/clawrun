import { getRuntimeConfig } from "../config.js";

/**
 * Resolve the agent workspace root inside a sandbox.
 *
 * Queries the sandbox HOME directory and appends `sandboxRoot` from
 * the runtime config (e.g. `~/.clawrun`).
 */
export async function resolveRoot(sandbox: {
  runCommand(cmd: string, args?: string[]): Promise<{ stdout(): Promise<string> }>;
}): Promise<string> {
  const { sandboxRoot } = getRuntimeConfig().instance;
  const result = await sandbox.runCommand("sh", ["-c", "echo ~"]);
  const home = (await result.stdout()).trim();
  return `${home}/${sandboxRoot}`;
}
