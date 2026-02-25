import {
  provision as zeroclawProvision,
  parseOutput,
  parseCronListOutput,
  buildAgentCommand,
  buildDaemonCommand,
  buildCronListCommand,
  HOUSEKEEPING_FILES,
  DAEMON_PROCESS_PATTERN,
} from "zeroclaw";
import type {
  Agent,
  SandboxHandle,
  AgentResponse,
  CronInfo,
  ExtendLoopConfig,
  ProvisionOpts,
} from "./types.js";
import { createLogger } from "@clawrun/logger";

const log = createLogger("agent:zeroclaw");

export class ZeroclawAgent implements Agent {
  readonly id = "zeroclaw";
  readonly name = "ZeroClaw";
  readonly channelsConfigKey = "channels_config";

  private env(root: string): Record<string, string> {
    return {
      ZEROCLAW_WORKSPACE: `${root}/agent`,
      ZEROCLAW_CONFIG_DIR: `${root}/agent`,
    };
  }

  async provision(sandbox: SandboxHandle, root: string, opts: ProvisionOpts): Promise<void> {
    await zeroclawProvision(sandbox, {
      binPath: `${root}/bin/zeroclaw`,
      agentDir: `${root}/agent`,
      localAgentDir: opts.localAgentDir,
      secretKey: opts.secretKey,
    });
  }

  async sendMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    opts?: {
      env?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<AgentResponse> {
    const cmd = buildAgentCommand(`${root}/bin/zeroclaw`, message, this.env(root));
    const result = await sandbox.runCommand({
      cmd: cmd.cmd,
      args: cmd.args,
      env: { ...cmd.env, ...opts?.env },
      signal: opts?.signal,
    });
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    const parsed = parseOutput(stdout, stderr, result.exitCode);
    return { success: parsed.success, message: parsed.message, error: parsed.error };
  }

  async startDaemon(
    sandbox: SandboxHandle,
    root: string,
    opts?: {
      port?: number;
      host?: string;
      env?: Record<string, string>;
    },
  ): Promise<void> {
    const cmd = buildDaemonCommand(`${root}/bin/zeroclaw`, this.env(root), opts);
    await sandbox.runCommand({
      cmd: cmd.cmd,
      args: cmd.args,
      env: { ...cmd.env, ...opts?.env },
      detached: true,
    });

    // Wait for daemon to initialize
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    // Verify daemon is running
    try {
      const ps = await sandbox.runCommand("sh", [
        "-c",
        `ps aux | grep '${DAEMON_PROCESS_PATTERN}' | grep -v grep`,
      ]);
      const psOut = await ps.stdout();
      if (psOut.trim()) {
        log.info(`Daemon started (PID ${psOut.trim().split(/\s+/)[1]})`);
      } else {
        log.warn("Daemon process not found after start");
      }
    } catch {
      // best-effort check
    }
  }

  async getCrons(sandbox: SandboxHandle, root: string): Promise<CronInfo> {
    const cmd = buildCronListCommand(`${root}/bin/zeroclaw`, {
      ZEROCLAW_WORKSPACE: `${root}/agent`,
    });
    const result = await sandbox.runCommand({
      cmd: cmd.cmd,
      args: cmd.args,
      env: cmd.env,
    });
    const stdout = await result.stdout();
    return parseCronListOutput(stdout);
  }

  getExtendLoopConfig(root: string): ExtendLoopConfig {
    return {
      monitorDir: `${root}/agent`,
      ignoreFiles: HOUSEKEEPING_FILES,
    };
  }
}
