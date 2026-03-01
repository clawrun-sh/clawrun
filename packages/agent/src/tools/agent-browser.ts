import type { Tool } from "../tools.js";
import type { SandboxHandle } from "../types.js";

/**
 * Agent-agnostic browser tool.
 * Installs the `agent-browser` CLI and its Chromium + system dependencies.
 * Any agent that needs a headless browser can include this in its tool list.
 */
export class AgentBrowserTool implements Tool {
  readonly id = "agent-browser";
  readonly name = "Agent Browser";
  readonly installDomains = [
    "registry.npmjs.org",
    "cdn.playwright.dev",
    "storage.googleapis.com",
    "cdn.amazonlinux.com",
  ];
  readonly checkCommand = { cmd: "which", args: ["agent-browser"] };
  readonly installCommands = [
    { cmd: "npm", args: ["install", "-g", "agent-browser"] },
    { cmd: "sh", args: ["-c", "agent-browser install --with-deps"] },
  ];

  async isInstalled(sandbox: SandboxHandle): Promise<boolean> {
    const which = await sandbox.runCommand(this.checkCommand.cmd, this.checkCommand.args);
    if (which.exitCode !== 0) return false;
    const version = await sandbox.runCommand("agent-browser", ["--version"]);
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
