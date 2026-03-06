import { execa } from "execa";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PlatformProvider } from "@clawrun/sdk";

/** Resolve the `sandbox` CLI binary from our own node_modules. */
function sandboxBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("sandbox/package.json");
  return join(dirname(pkgPath), "bin", "sandbox.mjs");
}

/**
 * Open an interactive shell in a running sandbox via the `sandbox` CLI binary.
 * This is the only CLI-specific sandbox operation — everything else delegates to SDK.
 */
export async function connectToSandbox(
  sandboxId: string,
  deployDir: string,
  platform: PlatformProvider,
  env?: Record<string, string>,
): Promise<void> {
  const connectArgs = platform.getConnectArgs(deployDir, sandboxId);
  const args = [sandboxBin(), "connect", ...connectArgs];
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      args.push("-e", `${k}=${v}`);
    }
  }
  await execa("node", args, { stdio: "inherit" });
}
