import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "../../tools.js";
import type { SandboxHandle } from "../../types.js";
import { githubReleaseUrl, releaseInstallSteps, releaseCheckCommand } from "../installer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GH_VERSION = "2.65.0";

const GH_SPEC = {
  downloadUrl: githubReleaseUrl("cli/cli", GH_VERSION, `gh_${GH_VERSION}_linux_amd64.tar.gz`),
  version: GH_VERSION,
  binaryPathInArchive: `gh_${GH_VERSION}_linux_amd64/bin/gh`,
  binaryName: "gh",
};

/**
 * GitHub CLI (`gh`).
 * Downloads the pinned release directly from GitHub (no third-party installer).
 */
export class GhCliTool implements Tool {
  readonly id = "gh-cli";
  readonly name = "GitHub CLI";
  readonly version = GH_VERSION;
  readonly description = "GitHub CLI for managing repos, issues, and PRs";
  readonly installDomains = [
    "github.com",
    "release-assets.githubusercontent.com",
    "api.github.com",
  ];
  readonly checkCommand = releaseCheckCommand("gh", GH_VERSION);
  readonly installCommands = releaseInstallSteps(GH_SPEC);
  readonly skillContent = readFileSync(join(__dirname, "SKILL.md"), "utf-8");

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
