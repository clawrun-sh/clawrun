import { readFileSync } from "node:fs";
import type { ZeroclawSandbox } from "./types.js";
import { getBinaryPath } from "./binary.js";
import { generateDaemonToml } from "./config-generator.js";
import { readParsedConfig } from "./config-reader.js";

export interface ProvisionOptions {
  binPath: string;
  agentDir: string;
  localAgentDir: string;
  secretKey: string;
}

export async function provision(sandbox: ZeroclawSandbox, opts: ProvisionOptions): Promise<void> {
  const { binPath, agentDir } = opts;
  const binDir = binPath.substring(0, binPath.lastIndexOf("/"));

  // Create directories
  await sandbox.runCommand("mkdir", ["-p", agentDir, binDir]);

  // Write binary
  const localBinary = getBinaryPath("linux-x64");
  await sandbox.writeFiles([{ path: binPath, content: readFileSync(localBinary) }]);

  // Make binary executable
  const chmodResult = await sandbox.runCommand("chmod", ["+x", binPath]);
  if (chmodResult.exitCode !== 0) {
    const stderr = await chmodResult.stderr();
    throw new Error(`chmod failed: ${stderr}`);
  }

  // Verify binary is executable
  const verify = await sandbox.runCommand("sh", ["-c", `test -x ${binPath} && echo ok`]);
  const out = (await verify.stdout()).trim();
  if (out !== "ok") {
    throw new Error(`Binary not executable after install: ${binPath}`);
  }

  // Read agent config from local dir and generate daemon TOML
  const parsed = readParsedConfig(opts.localAgentDir);
  const toml = generateDaemonToml(parsed);

  // Write config + .secret_key (secret key is passed from local — never regenerated)
  await sandbox.writeFiles([
    { path: `${agentDir}/config.toml`, content: Buffer.from(toml) },
    { path: `${agentDir}/.secret_key`, content: Buffer.from(opts.secretKey) },
  ]);

  // Write .profile so interactive shells (connect) get the right env.
  // Do NOT override HOME — the sandbox's native HOME is correct.
  // Set CLOUDCLAW_ROOT so scripts can find the instance layout.
  const root = binDir.substring(0, binDir.lastIndexOf("/"));
  const profile = [
    `export CLOUDCLAW_ROOT="${root}"`,
    `export ZEROCLAW_WORKSPACE="${agentDir}"`,
    `export ZEROCLAW_CONFIG_DIR="${agentDir}"`,
    "",
  ].join("\n");

  // Write .profile to $HOME (not to root, which is $HOME/.cloudclaw)
  const homeResult = await sandbox.runCommand("sh", ["-c", "echo $HOME"]);
  const home = (await homeResult.stdout()).trim() || "/home/vercel-sandbox";
  await sandbox.writeFiles([{ path: `${home}/.profile`, content: Buffer.from(profile) }]);
}
