import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../../tools.js";
import type { SandboxHandle } from "../../types.js";
import { githubReleaseUrl, releaseInstallSteps, releaseCheckCommand } from "../installer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    // After the binary is in place, download Chromium + system deps.
    // AGENT_BROWSER_NATIVE=1 makes the binary use its built-in Rust daemon
    // instead of looking for daemon.js from the npm package.
    {
      cmd: "sh",
      args: ["-c", "AGENT_BROWSER_NATIVE=1 $HOME/.local/bin/agent-browser install --with-deps"],
    },
  ];
  // The standalone binary needs native mode to use its built-in Rust daemon
  // instead of searching for daemon.js (which only ships with the npm package).
  // MAX_OUTPUT caps snapshot size to prevent context overflow (default is unlimited;
  // dense pages like HN produce 64K+ chars). 50K is the agent-browser recommended
  // value — leaves most pages untouched while preventing context flooding.
  readonly runtimeEnv = {
    AGENT_BROWSER_NATIVE: "1",
    AGENT_BROWSER_MAX_OUTPUT: "50000",
  };
  readonly skillContent = readFileSync(join(__dirname, "SKILL.md"), "utf-8");

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
