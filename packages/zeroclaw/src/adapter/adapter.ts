import type {
  AgentAdapter,
  AgentEnv,
  AgentResponse,
  BinaryAsset,
  SandboxCommand,
  SandboxFile,
} from "./types.js";
import { buildAgentCommand, buildOnboardCommand } from "../command-builder.js";
import { parseOutput } from "../output-parser.js";
import { getBinaryPath } from "../binary.js";

const ZEROCLAW_BIN_PATH = "/tmp/zeroclaw";

export const zeroclawAdapter: AgentAdapter = {
  id: "zeroclaw",
  name: "ZeroClaw",

  generateConfig(_env: AgentEnv): SandboxFile[] {
    return [];
  },

  buildCommand(message: string): SandboxCommand {
    return buildAgentCommand(ZEROCLAW_BIN_PATH, message);
  },

  parseResponse(stdout: string, stderr: string, exitCode: number): AgentResponse {
    const result = parseOutput(stdout, stderr, exitCode);
    return {
      success: result.success,
      message: result.message,
      error: result.error,
    };
  },

  binaryAssets(): BinaryAsset[] {
    return [
      {
        localPath: getBinaryPath("linux-x64"),
        sandboxPath: ZEROCLAW_BIN_PATH,
      },
    ];
  },

  installCommands(): SandboxCommand[] {
    return [
      {
        cmd: "chmod",
        args: ["+x", ZEROCLAW_BIN_PATH],
      },
    ];
  },

  onboardCommand(env: AgentEnv): SandboxCommand {
    return buildOnboardCommand(ZEROCLAW_BIN_PATH, {
      provider: env.llmProvider,
      apiKey: env.llmApiKey,
      model: env.llmModel,
      memory: "postgres",
    });
  },
};
