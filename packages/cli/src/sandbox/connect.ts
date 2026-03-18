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
 * Resolves the sandbox HOME (same pattern as runtime/resolve-root.ts), then
 * connects with --workdir and -e flags for the ClawRun env vars.
 */
export async function connectToSandbox(
  sandboxId: string,
  deployDir: string,
  platform: PlatformProvider,
  sandboxRoot = ".clawrun",
): Promise<void> {
  const connectArgs = platform.getConnectArgs(deployDir, sandboxId);
  const bin = sandboxBin();

  // Resolve HOME — same approach as runtime/resolve-root.ts
  const homeResult = await execa("node", [
    bin,
    "exec",
    ...connectArgs,
    "--",
    "sh",
    "-c",
    "echo $HOME",
  ]);
  const home = homeResult.stdout.trim();
  if (!home) {
    throw new Error("Failed to resolve sandbox HOME directory");
  }

  const root = `${home}/${sandboxRoot}`;
  const agentDir = `${root}/agent`;

  await execa(
    "node",
    [
      bin,
      "connect",
      ...connectArgs,
      "--workdir",
      root,
      "-e",
      `CLAWRUN_ROOT=${root}`,
      "-e",
      `ZEROCLAW_WORKSPACE=${agentDir}`,
      "-e",
      `ZEROCLAW_CONFIG_DIR=${agentDir}`,
    ],
    { stdio: "inherit" },
  );
}
