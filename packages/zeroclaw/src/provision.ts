import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
import type { ZeroclawSandbox } from "./types.js";
import type { Config as ZeroClawConfig } from "./generated/zeroclaw-config.js";
import { getBinaryPath } from "./binary.js";
import { generateDaemonToml } from "./config-generator.js";
import { readParsedConfig } from "./config-reader.js";

export interface ProvisionOptions {
  binPath: string;
  agentDir: string;
  localAgentDir: string;
  secretKey: string;
  fromSnapshot?: boolean;
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

  // Always write config + .secret_key (may have been updated by deploy/upgrade)
  const coreFiles: { path: string; content: Buffer }[] = [
    { path: `${agentDir}/config.toml`, content: Buffer.from(toml) },
    { path: `${agentDir}/.secret_key`, content: Buffer.from(opts.secretKey) },
  ];

  // Only write workspace .md files on fresh sandbox (not snapshot restore).
  // Snapshots already contain the agent's customized workspace files
  // (IDENTITY.md, USER.md, deleted BOOTSTRAP.md, etc.).
  if (!opts.fromSnapshot) {
    const localWorkspaceDir = join(opts.localAgentDir, "workspace");
    try {
      const mdFiles = readdirSync(localWorkspaceDir).filter((f) => f.endsWith(".md"));
      const workspaceFiles = mdFiles.map((f) => ({
        path: `${agentDir}/workspace/${f}`,
        content: readFileSync(join(localWorkspaceDir, f)),
      }));
      coreFiles.push(...workspaceFiles);
    } catch {
      // No workspace dir — skip
    }
  }

  await sandbox.writeFiles(coreFiles);

  // Restrict permissions on sensitive files so zeroclaw doesn't warn
  await sandbox.runCommand("chmod", ["600", `${agentDir}/config.toml`, `${agentDir}/.secret_key`]);

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

export interface InstallToolsOptions {
  agentDir: string;
}

/**
 * Install external tools that ZeroClaw needs (e.g. agent-browser for web browsing).
 * Reads config.toml from the sandbox to check if [browser].enabled = true.
 * Only installs if the user opted in via their config.
 */
export async function installTools(
  sandbox: ZeroclawSandbox,
  opts: InstallToolsOptions,
): Promise<void> {
  // Read the config to check if browser is enabled
  const configBuf = await sandbox.readFile(`${opts.agentDir}/config.toml`);
  if (!configBuf) return;

  const config = TOML.parse(configBuf.toString("utf-8")) as unknown as ZeroClawConfig;
  if (!config.browser?.enabled) return;

  // Install agent-browser CLI globally
  const npmResult = await sandbox.runCommand("npm", ["install", "-g", "agent-browser"]);
  if (npmResult.exitCode !== 0) {
    const stderr = await npmResult.stderr();
    throw new Error(`Failed to install agent-browser: ${stderr}`);
  }

  // Install Chromium + system deps
  const installResult = await sandbox.runCommand("sh", ["-c", "agent-browser install --with-deps"]);
  if (installResult.exitCode !== 0) {
    const stderr = await installResult.stderr();
    throw new Error(`Failed to install browser dependencies: ${stderr}`);
  }
}
