import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ZeroClawConfig, ZeroClawResult, CommandSpec } from "./types.js";
import { buildAgentCommand, buildOnboardCommand } from "./command-builder.js";
import { parseOutput } from "./output-parser.js";
import { getBinaryPath } from "./binary.js";

const execFileAsync = promisify(execFile);

export class ZeroClaw {
  private config: ZeroClawConfig;
  private binaryPath: string;

  constructor(config: ZeroClawConfig) {
    this.config = config;
    this.binaryPath = config.binaryPath ?? getBinaryPath();
  }

  agentCommand(message: string): CommandSpec {
    return buildAgentCommand(this.binaryPath, message);
  }

  onboardCommand(): CommandSpec {
    return buildOnboardCommand(this.binaryPath, this.config);
  }

  async run(message: string): Promise<ZeroClawResult> {
    const cmd = this.agentCommand(message);

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
