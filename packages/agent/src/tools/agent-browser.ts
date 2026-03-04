import type { Tool } from "../tools.js";
import type { SandboxHandle } from "../types.js";
import { githubReleaseUrl, releaseInstallSteps, releaseCheckCommand } from "./installer.js";

const AB_VERSION = "0.16.3";

const AB_SPEC = {
  downloadUrl: githubReleaseUrl("vercel-labs/agent-browser", AB_VERSION, "agent-browser-linux-x64"),
  version: AB_VERSION,
  binaryPathInArchive: "agent-browser-linux-x64",
  binaryName: "agent-browser",
};

/**
 * Agent-agnostic browser tool.
 * Downloads the standalone binary from GitHub releases, then runs
 * `agent-browser install --with-deps` to fetch Chromium + system libraries.
 */
export class AgentBrowserTool implements Tool {
  readonly id = "agent-browser";
  readonly name = "Agent Browser";
  readonly version = AB_VERSION;
  readonly description = "Headless Chromium browser for web browsing and screenshots";
  readonly installDomains = [
    "github.com",
    "objects.githubusercontent.com",
    "cdn.playwright.dev",
    "storage.googleapis.com",
    "cdn.amazonlinux.com",
  ];
  readonly checkCommand = releaseCheckCommand("agent-browser", AB_VERSION);
  readonly installCommands = [
    ...releaseInstallSteps(AB_SPEC),
    // After the binary is in place, download Chromium + system deps
    { cmd: "sh", args: ["-c", "$HOME/.local/bin/agent-browser install --with-deps"] },
  ];

  async isInstalled(sandbox: SandboxHandle): Promise<boolean> {
    const check = await sandbox.runCommand(this.checkCommand.cmd, this.checkCommand.args);
    if (check.exitCode !== 0) return false;
    const version = await sandbox.runCommand("$HOME/.local/bin/agent-browser", ["--version"]);
    return version.exitCode === 0;
  }

  async install(sandbox: SandboxHandle): Promise<void> {
    for (const step of this.installCommands) {
      const result = await sandbox.runCommand(step.cmd, step.args);
      if (result.exitCode !== 0) {
        const stderr = await result.stderr();
        throw new Error(`Failed: ${step.cmd} ${step.args.join(" ")}: ${stderr}`);
      }
    }
  }
}
