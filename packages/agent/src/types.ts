export interface CommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

export interface SandboxHandle {
  runCommand(cmd: string, args?: string[]): Promise<CommandResult>;
  runCommand(opts: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
    signal?: AbortSignal;
    detached?: boolean;
  }): Promise<CommandResult>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  readFile(path: string): Promise<Buffer | null>;
}

export interface AgentResponse {
  success: boolean;
  message: string;
  error?: string;
}

export interface CronEntry {
  name?: string;
  schedule?: string;
  nextRunAt: string;
}

export interface CronInfo {
  jobs: CronEntry[];
}

export interface DaemonCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

export interface MonitorConfig {
  dir: string;
  ignoreFiles: string[];
}

export interface ProvisionOpts {
  localAgentDir: string;
  secretKey: string;
}

export interface Agent {
  readonly id: string;
  readonly name: string;

  /** Key in agent's parsed config that holds per-channel configuration. */
  readonly channelsConfigKey: string;

  provision(sandbox: SandboxHandle, root: string, opts: ProvisionOpts): Promise<void>;

  sendMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    opts?: {
      env?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<AgentResponse>;

  getDaemonCommand(
    root: string,
    opts?: {
      port?: number;
      host?: string;
      env?: Record<string, string>;
    },
  ): DaemonCommand;

  getCrons(sandbox: SandboxHandle, root: string): Promise<CronInfo>;

  getMonitorConfig(root: string): MonitorConfig;
}
