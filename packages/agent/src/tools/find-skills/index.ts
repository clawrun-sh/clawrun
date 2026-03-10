import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool, ToolInstallStep } from "../../tools.js";
import type { SandboxHandle } from "../../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILLS_VERSION = "1.4.4";

/** Compiled wrapper JS content, base64-encoded for safe shell transport. */
const WRAPPER_JS_B64 = Buffer.from(
  readFileSync(join(__dirname, "skill-finder.js"), "utf-8"),
).toString("base64");

/**
 * Find Skills — discover and install agent skills from skills.sh.
 *
 * Installs the real `skills` binary via npm, then drops a wrapper script
 * at `~/.clawrun/bin/skills` that shadows it via PATH ordering.
 * The wrapper forces `-a openclaw -y --copy` on `add`/`install` commands.
 */
export class FindSkillsTool implements Tool {
  readonly id = "find-skills";
  readonly name = "Find Skills";
  readonly version = SKILLS_VERSION;
  readonly description = "Discover and install agent skills from the skills.sh registry";
  readonly installDomains = ["registry.npmjs.org", "github.com"];
  readonly checkCommand = {
    cmd: "sh",
    args: [
      "-c",
      // Check both: real binary installed AND our wrapper in place
      `skills --version 2>/dev/null | grep -q "${SKILLS_VERSION}" && test -x "$HOME/.clawrun/bin/skills"`,
    ],
  };
  readonly installCommands: ToolInstallStep[] = [
    // Step 1: Install the real skills binary via npm
    { cmd: "sh", args: ["-c", `npm install -g skills@${SKILLS_VERSION}`] },
    // Step 2: Write our wrapper to ~/.clawrun/bin/skills (shadows real via PATH)
    {
      cmd: "sh",
      args: [
        "-c",
        `echo "${WRAPPER_JS_B64}" | base64 -d > "$HOME/.clawrun/bin/skills" && chmod +x "$HOME/.clawrun/bin/skills"`,
      ],
    },
  ];
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
