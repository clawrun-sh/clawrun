import type { SandboxHandle, CommandResult } from "@clawrun/agent";
import type { SandboxClient, SandboxEntry } from "@clawrun/sdk";

type SandboxId = SandboxEntry["id"];

/**
 * Wrap an SDK SandboxClient + sandboxId into the Agent's SandboxHandle interface.
 * Adapts the SDK client's exec() to the async CommandResult shape.
 */
export function createSandboxHandle(
  client: SandboxClient,
  sandboxId: SandboxId,
  options?: { timeoutMs?: number },
): SandboxHandle {
  const timeoutMs = options?.timeoutMs ?? 150_000;

  return {
    async runCommand(
      cmdOrOpts:
        | string
        | {
            cmd: string;
            args?: string[];
            env?: Record<string, string>;
            signal?: AbortSignal;
            detached?: boolean;
          },
      args?: string[],
    ): Promise<CommandResult> {
      let cmd: string;
      let cmdArgs: string[];
      let env: Record<string, string> | undefined;

      if (typeof cmdOrOpts === "string") {
        cmd = cmdOrOpts;
        cmdArgs = args ?? [];
      } else {
        cmd = cmdOrOpts.cmd;
        cmdArgs = cmdOrOpts.args ?? [];
        env = cmdOrOpts.env;
      }

      const result = await client.exec(sandboxId, cmd, cmdArgs, env, { timeoutMs });
      return {
        exitCode: result.exitCode,
        stdout: async () => result.stdout,
        stderr: async () => result.stderr,
      };
    },

    async writeFiles(): Promise<void> {
      throw new Error("writeFiles not supported via CLI sandbox client");
    },

    async readFile(path: string): Promise<Buffer | null> {
      return client.readFile(sandboxId, path);
    },
  };
}
