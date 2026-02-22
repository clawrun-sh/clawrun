import type { SandboxCommand } from "./adapter/types.js";

/** Default workspace inside the sandbox — must match the daemon's ZEROCLAW_WORKSPACE. */
const SANDBOX_WORKSPACE = "/tmp/.zeroclaw";

export function buildAgentCommand(
  binaryPath: string,
  message: string,
): SandboxCommand {
  return {
    cmd: binaryPath,
    args: ["agent", "-m", message],
    env: { HOME: "/tmp", ZEROCLAW_WORKSPACE: SANDBOX_WORKSPACE },
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
