import type { SandboxHandle } from "./types.js";

export interface ToolInstallStep {
  cmd: string;
  args: string[];
}

export interface Tool {
  readonly id: string;
  readonly name: string;
  /** Short human-readable description of what the tool does. */
  readonly description: string;
  /** Pinned version for display/tracking, e.g. "2.65.0". */
  readonly version?: string;
  /** Hostnames the tool needs to reach during installation (npm, CDNs, etc.). */
  readonly installDomains: string[];
  /** Command to check if the tool is already installed (exit 0 = installed). */
  readonly checkCommand: { cmd: string; args: string[] };
  /** Sequential install steps. */
  readonly installCommands: ToolInstallStep[];
  isInstalled(sandbox: SandboxHandle): Promise<boolean>;
  install(sandbox: SandboxHandle): Promise<void>;
}

export interface ToolResult {
  toolId: string;
  action: "skipped" | "installed" | "failed";
  durationMs: number;
  error?: string;
}

/**
 * Run a list of tools sequentially on a sandbox.
 * Each tool is checked with `isInstalled()` first — if already present, it's
 * skipped. Otherwise `install()` is called.
 * Fails fast on the first error.
 */
export async function runTools(sandbox: SandboxHandle, tools: Tool[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const tool of tools) {
    const start = Date.now();
    try {
      const installed = await tool.isInstalled(sandbox);
      if (installed) {
        results.push({
          toolId: tool.id,
          action: "skipped",
          durationMs: Date.now() - start,
        });
        continue;
      }

      await tool.install(sandbox);
      results.push({
        toolId: tool.id,
        action: "installed",
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        toolId: tool.id,
        action: "failed",
        durationMs: Date.now() - start,
        error,
      });
      break; // fail-fast
    }
  }

  return results;
}
