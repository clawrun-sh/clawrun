import type { SandboxCommand } from "./adapter/types.js";

export function buildAgentCommand(
  binaryPath: string,
  message: string,
): SandboxCommand {
  return {
    cmd: binaryPath,
    args: ["agent", "-m", message],
    env: { HOME: "/tmp" },
  };
}

export function buildOnboardCommand(
  binaryPath: string,
  config: {
    provider: string;
    apiKey: string;
    model?: string;
  },
): SandboxCommand {
  return {
    cmd: binaryPath,
    args: [
      "onboard",
      "--api-key", config.apiKey,
      "--provider", config.provider,
    ],
    env: { HOME: "/tmp" },
  };
}

export function buildDaemonCommand(
  binaryPath: string,
  options?: { port?: number; host?: string },
): SandboxCommand {
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
