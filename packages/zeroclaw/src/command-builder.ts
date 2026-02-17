import type { ZeroClawConfig, ChatMessage, CommandSpec } from "./types.js";

const PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
};

export function buildAgentCommand(
  binaryPath: string,
  message: string,
  history?: ChatMessage[],
): CommandSpec {
  let prompt = message;

  if (history && history.length > 0) {
    const historyText = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    prompt = `[Conversation history]\n${historyText}\n\n[New message]\n${message}`;
  }

  return {
    cmd: binaryPath,
    args: ["agent", "-m", prompt],
    env: { HOME: "/tmp" },
  };
}

export function buildOnboardCommand(
  binaryPath: string,
  config: ZeroClawConfig,
): CommandSpec {
  const provider = PROVIDER_MAP[config.provider] ?? config.provider;

  const args = [
    "onboard",
    "--api-key", config.apiKey,
    "--provider", provider,
    "--memory", config.memory ?? "none",
  ];

  return {
    cmd: binaryPath,
    args,
    env: { HOME: "/tmp" },
  };
}
