import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ZeroClawConfig, ZeroClawResult, ChatMessage, CommandSpec } from "./types.js";
import { buildAgentCommand, buildOnboardCommand } from "./command-builder.js";
import { parseOutput } from "./output-parser.js";
import { getBinaryPath } from "./binary.js";

const execFileAsync = promisify(execFile);

export class ZeroClaw {
  private config: ZeroClawConfig;
  private binaryPath: string;

  constructor(config: ZeroClawConfig) {
    this.config = config;

    if (config.binaryPath) {
      this.binaryPath = config.binaryPath;
    } else {
      const resolved = getBinaryPath();
      if (!resolved) {
        throw new Error(
          "ZeroClaw binary not found. Call ensureBinary() first, " +
          "or pass binaryPath in the config.",
        );
      }
      this.binaryPath = resolved;
    }
  }

  /**
   * Returns a CommandSpec for running the agent — does NOT execute.
   * Use this when you need to run the command in a sandbox, Docker, SSH, etc.
   */
  agentCommand(message: string, history?: ChatMessage[]): CommandSpec {
    return buildAgentCommand(this.binaryPath, message, history);
  }

  /**
   * Returns a CommandSpec for onboarding — does NOT execute.
   */
  onboardCommand(): CommandSpec {
    return buildOnboardCommand(this.binaryPath, this.config);
  }

  /**
   * Convenience: runs the agent locally via child_process and returns the result.
   */
  async run(message: string, history?: ChatMessage[]): Promise<ZeroClawResult> {
    const cmd = this.agentCommand(message, history);

    try {
      const { stdout, stderr } = await execFileAsync(cmd.cmd, cmd.args, {
        env: { ...process.env, ...cmd.env },
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return parseOutput(stdout, stderr, 0);
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; code?: number };
      return parseOutput(
        error.stdout ?? "",
        error.stderr ?? "",
        error.code ?? 1,
      );
    }
  }
}
