import type { Tool } from "../tools.js";
import type { SandboxHandle } from "../types.js";

/**
 * GitHub CLI (`gh`).
 * Installs via webi.sh (user-space, no root required).
 */
export class GhCliTool implements Tool {
  readonly id = "gh-cli";
  readonly name = "GitHub CLI";
  readonly description = "GitHub CLI for managing repos, issues, and PRs";
  readonly installDomains = [
    "webi.sh",
    "github.com",
    "release-assets.githubusercontent.com",
    "api.github.com",
  ];
  readonly checkCommand = { cmd: "sh", args: ["-c", "command -v gh"] };
  readonly installCommands = [{ cmd: "sh", args: ["-c", "curl -fsSL https://webi.sh/gh | sh"] }];

  async isInstalled(sandbox: SandboxHandle): Promise<boolean> {
    const result = await sandbox.runCommand(this.checkCommand.cmd, this.checkCommand.args);
    return result.exitCode === 0;
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
