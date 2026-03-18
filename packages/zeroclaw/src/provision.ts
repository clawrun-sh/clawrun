import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ZeroclawSandbox } from "./types.js";
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

  // Read agent config from local dir and generate daemon TOML with
  // sandbox-specific overrides. The zeroclaw binary applies its own
  // defaults via #[serde(default)] for any missing fields.
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

  // Always write skill directories — skills are tool definitions managed by
  // ClawRun, not user-editable content. New tools added between deploys must
  // be available even when restoring from snapshot.
  const skillsDir = join(opts.localAgentDir, "workspace", "skills");
  try {
    for (const skillName of readdirSync(skillsDir)) {
      const skillDir = join(skillsDir, skillName);
      if (!statSync(skillDir).isDirectory()) continue;
      for (const file of readdirSync(skillDir)) {
        coreFiles.push({
          path: `${agentDir}/workspace/skills/${skillName}/${file}`,
          content: readFileSync(join(skillDir, file)),
        });
      }
    }
  } catch {
    // No skills dir — skip
  }

  await sandbox.writeFiles(coreFiles);

  // Restrict permissions on sensitive files so zeroclaw doesn't warn
  await sandbox.runCommand("chmod", ["600", `${agentDir}/config.toml`, `${agentDir}/.secret_key`]);

  // Write .profile so interactive shells (connect) get the right env.
  // Do NOT override HOME — the sandbox's native HOME is correct.
  // Set CLAWRUN_ROOT so scripts can find the instance layout.
  const root = binDir.substring(0, binDir.lastIndexOf("/"));
  const profile = [
    `export CLAWRUN_ROOT="${root}"`,
    `export ZEROCLAW_WORKSPACE="${agentDir}"`,
    `export ZEROCLAW_CONFIG_DIR="${agentDir}"`,
    `export SHELL="\${SHELL:-/bin/bash}"`,
    "",
  ].join("\n");

  // Write .profile to $HOME (not to root, which is $HOME/.clawrun)
  const homeResult = await sandbox.runCommand("sh", ["-c", "echo $HOME"]);
  const home = (await homeResult.stdout()).trim();
  await sandbox.writeFiles([{ path: `${home}/.profile`, content: Buffer.from(profile) }]);
}
