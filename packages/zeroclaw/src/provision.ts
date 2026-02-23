import { readFileSync } from "node:fs";
import type { ZeroclawSandbox } from "./types.js";
import { getBinaryPath } from "./binary.js";
import { generateDaemonTomlFromJson } from "./config-generator.js";

export interface ProvisionOptions {
  binPath: string;
  agentDir: string;
  configJson: string;
}

export async function provision(
  sandbox: ZeroclawSandbox,
  opts: ProvisionOptions,
): Promise<void> {
  const { binPath, agentDir, configJson } = opts;
  const binDir = binPath.substring(0, binPath.lastIndexOf("/"));

  // Create directories
  await sandbox.runCommand("mkdir", ["-p", agentDir, binDir]);

  // Write binary
  const localBinary = getBinaryPath("linux-x64");
  await sandbox.writeFiles([
    { path: binPath, content: readFileSync(localBinary) },
  ]);

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

  // Generate TOML config
  const toml = generateDaemonTomlFromJson(configJson);

  // Generate .secret_key
  const secretKeyResult = await sandbox.runCommand("sh", ["-c", "head -c 32 /dev/urandom | base64"]);
  const secretKey = (await secretKeyResult.stdout()).trim();

  // Write config + .secret_key
  await sandbox.writeFiles([
    { path: `${agentDir}/config.toml`, content: Buffer.from(toml) },
    { path: `${agentDir}/.secret_key`, content: Buffer.from(secretKey) },
  ]);

  // Write .profile so interactive shells (connect) get the right env
  const root = binDir.substring(0, binDir.lastIndexOf("/"));
  const profile = [
    `export HOME="${root}"`,
    `export ZEROCLAW_WORKSPACE="${agentDir}"`,
    `export ZEROCLAW_CONFIG_DIR="${agentDir}"`,
    "",
  ].join("\n");
  await sandbox.writeFiles([
    { path: `${root}/.profile`, content: Buffer.from(profile) },
  ]);
}
