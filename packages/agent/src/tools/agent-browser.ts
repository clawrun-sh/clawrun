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

  async isInstalled(sandbox: SandboxHandle): Promise<boolean> {
    // Quick check: is the CLI on PATH?
    const which = await sandbox.runCommand("which", ["agent-browser"]);
    if (which.exitCode !== 0) return false;

    // Functional check: can it report its version?
    const version = await sandbox.runCommand("agent-browser", ["--version"]);
    return version.exitCode === 0;
  }

  async install(sandbox: SandboxHandle): Promise<void> {
    // Install the CLI globally
    const npm = await sandbox.runCommand("npm", ["install", "-g", "agent-browser"]);
    if (npm.exitCode !== 0) {
      const stderr = await npm.stderr();
      throw new Error(`Failed to install agent-browser: ${stderr}`);
    }

    // Install Chromium + system deps
    const deps = await sandbox.runCommand("sh", ["-c", "agent-browser install --with-deps"]);
    if (deps.exitCode !== 0) {
      const stderr = await deps.stderr();
      throw new Error(`Failed to install browser dependencies: ${stderr}`);
    }
  }
}
