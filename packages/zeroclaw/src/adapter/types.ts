export interface AgentEnv {
  configJson: string; // Full agent config as JSON (from napi getSavedConfig)
  llmProvider: string; // Extracted for CloudClaw's own use
  llmApiKey: string;
  llmModel: string;
  memoryBackend?: string;
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

export interface ChannelConfig {
  telegram?: { botToken: string; allowedUsers?: string[] };
  discord?: { botToken: string };
  slack?: { botToken: string; appToken?: string };
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
  buildDaemonCommand?(options?: { port?: number; host?: string }): SandboxCommand;
  generateDaemonConfig?(env: AgentEnv, channels: ChannelConfig): SandboxFile[];
}
