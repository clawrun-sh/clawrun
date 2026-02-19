import type { ZeroClawConfig, CommandSpec } from "./types.js";

const PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openrouter",
};

export function buildAgentCommand(
  binaryPath: string,
  message: string,
): CommandSpec {
  return {
    cmd: binaryPath,
    args: ["agent", "-m", message],
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
  ];

  if (config.memory) {
    args.push("--memory", config.memory);
  }

  return {
    cmd: binaryPath,
    args,
    env: { HOME: "/tmp" },
  };
}

export function buildDaemonCommand(
  binaryPath: string,
  options?: { port?: number; host?: string },
): CommandSpec {
  return {
    cmd: binaryPath,
    args: [
      "daemon",
      "--port", String(options?.port ?? 3000),
      "--host", options?.host ?? "0.0.0.0",
    ],
    env: { HOME: "/tmp" },
  };
}
