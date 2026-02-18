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
  sandboxPath: string;
  localPath: string;
}

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  generateConfig(env: AgentEnv): SandboxFile[];
  buildCommand(message: string): SandboxCommand;
  parseResponse(stdout: string, stderr: string, exitCode: number): AgentResponse;
  binaryAssets(): BinaryAsset[];
  installCommands(): SandboxCommand[];
  onboardCommand?(env: AgentEnv): SandboxCommand;
}
