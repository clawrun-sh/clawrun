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
