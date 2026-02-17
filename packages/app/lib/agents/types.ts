import type { ChatMessage } from "../storage/types";

export interface AgentEnv {
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
}

export interface SandboxFile {
  path: string;
  content: string;
}

export interface SandboxCommand {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentResponse {
  success: boolean;
  message: string;
  error?: string;
}

export interface BinaryAsset {
  /** Path inside the sandbox where the binary should be written */
  sandboxPath: string;
  /** Path on the function's filesystem (relative to app root) */
  localPath: string;
}

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  generateConfig(env: AgentEnv, history?: ChatMessage[]): SandboxFile[];
  buildCommand(message: string, history?: ChatMessage[]): SandboxCommand;
  parseResponse(
    stdout: string,
    stderr: string,
    exitCode: number,
  ): AgentResponse;
  /** Binary files to push into the sandbox before install commands run */
  binaryAssets(): BinaryAsset[];
  /** Commands to run inside the sandbox after binary assets are written (e.g. chmod) */
  installCommands(): SandboxCommand[];
  /** Optional command to bootstrap the agent config (e.g. `zeroclaw onboard`) */
  onboardCommand?(env: AgentEnv): SandboxCommand;
}
