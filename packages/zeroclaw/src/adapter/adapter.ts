import type {
  AgentAdapter,
  AgentEnv,
  AgentResponse,
  BinaryAsset,
  ChannelConfig,
  SandboxCommand,
  SandboxFile,
} from "./types.js";
import { buildAgentCommand, buildOnboardCommand, buildDaemonCommand } from "../command-builder.js";
import { generateDaemonToml } from "../config-generator.js";
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

  buildDaemonCommand(options?: { port?: number; host?: string }): SandboxCommand {
    return buildDaemonCommand(ZEROCLAW_BIN_PATH, options);
  },

  generateDaemonConfig(env: AgentEnv, channels: ChannelConfig): SandboxFile[] {
    const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    const toml = generateDaemonToml(env, channels, { databaseUrl });
    return [{ path: "/tmp/.zeroclaw/config.toml", content: toml }];
  },
};
