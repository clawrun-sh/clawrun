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
    env,
  };
}

export function buildDaemonCommand(
  binaryPath: string,
  env: Record<string, string>,
  options?: { port?: number; host?: string },
): SandboxCommand {
  return {
    cmd: binaryPath,
    args: ["daemon", "--port", String(options?.port ?? 3000), "--host", options?.host ?? "0.0.0.0"],
    env,
  };
}

export function buildCronListCommand(
  binaryPath: string,
  env: Record<string, string>,
): SandboxCommand {
  return {
    cmd: binaryPath,
    args: ["cron", "list"],
    env,
  };
}
