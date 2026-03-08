import { DAEMON_PORT, DAEMON_HOST } from "./constants.js";

interface SandboxCommand {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

export function buildAgentCommand(
  binaryPath: string,
  message: string,
  env: Record<string, string>,
): SandboxCommand {
  return {
    cmd: binaryPath,
    args: ["agent", "-m", message],
    env: { RUST_LOG: "warn", ...env },
  };
}

export function buildDaemonCommand(
  binaryPath: string,
  env: Record<string, string>,
  options?: { port?: number; host?: string },
): SandboxCommand {
  return {
    cmd: binaryPath,
    args: [
      "daemon",
      "--port",
      String(options?.port ?? DAEMON_PORT),
      "--host",
      options?.host ?? DAEMON_HOST,
    ],
    env,
  };
}
