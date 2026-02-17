export interface ZeroClawConfig {
  provider: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  memory?: "sqlite" | "markdown" | "none";
  binaryPath?: string;
}

export interface ZeroClawResult {
  success: boolean;
  message: string;
  error?: string;
  exitCode: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface CommandSpec {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}
