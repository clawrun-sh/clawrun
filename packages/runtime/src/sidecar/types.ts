export interface ToolConfig {
  id: string;
  /** Command to check if already installed (exit 0 = installed). */
  check: { cmd: string; args: string[] };
  /** Install steps, run sequentially. */
  install: Array<{ cmd: string; args: string[] }>;
  /** Environment variables needed at runtime. Values may contain $HOME. */
  env?: Record<string, string>;
}

export interface SidecarConfig {
  daemon: {
    cmd: string;
    args: string[];
    env: Record<string, string>;
    port: number;
    readyTimeout: number;
  };
  heartbeat: {
    url: string;
    sandboxId: string;
    intervalMs: number;
  };
  monitor: {
    dir: string;
    ignoreFiles: string[];
  };
  health: {
    port: number;
  };
  tools?: ToolConfig[];
  root: string;
}

export interface SidecarState {
  daemonPid: number | null;
  daemonStatus: "starting" | "running" | "stopped" | "failed";
  daemonRestarts: number;
  lastHeartbeatTick: number;
  lastHeartbeatSuccess: boolean;
  lastMtime: number;
  lastChangedAt: number;
  createdAt: number;
}
