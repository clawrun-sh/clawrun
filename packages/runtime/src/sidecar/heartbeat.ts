import { getMaxMtime } from "./mtime.js";
import type { SidecarConfig, SidecarState } from "./types.js";
import { createLogger } from "./log.js";

let log: ReturnType<typeof createLogger>;
function getLog() {
  if (!log) log = createLogger("heartbeat");
  return log;
}

async function heartbeatTick(
  config: SidecarConfig,
  state: SidecarState,
  secret: string,
): Promise<void> {
  const currMtime = getMaxMtime(config.monitor.dir, config.monitor.ignoreFiles);

  if (currMtime !== state.lastMtime) {
    state.lastChangedAt = Date.now();
    state.lastMtime = currMtime;
  }

  try {
    const res = await fetch(config.heartbeat.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sandboxId: config.heartbeat.sandboxId,
        lastChangedAt: state.lastChangedAt,
        sandboxCreatedAt: state.createdAt,
        root: config.root,
        daemonStatus: state.daemonStatus,
        daemonRestarts: state.daemonRestarts,
      }),
    });
    if (res.ok) {
      state.lastHeartbeatSuccess = true;
      getLog().info(await res.text());
    } else {
      state.lastHeartbeatSuccess = false;
      getLog().error(`HTTP ${res.status}: ${await res.text()}`);
    }
    state.lastHeartbeatTick = Date.now();
  } catch (err: unknown) {
    state.lastHeartbeatSuccess = false;
    state.lastHeartbeatTick = Date.now();
    const message = err instanceof Error ? err.message : String(err);
    getLog().error(message);
  }
}

export function startHeartbeat(config: SidecarConfig, state: SidecarState): { stop(): void } {
  const secret = process.env.CLAWRUN_HB_SECRET;
  if (!secret) {
    getLog().error("CLAWRUN_HB_SECRET not set, heartbeat disabled");
    return { stop() {} };
  }

  const safeTick = () => {
    heartbeatTick(config, state, secret).catch((err) => {
      getLog().error("tick failed: %o", err);
    });
  };

  safeTick();
  const timer = setInterval(safeTick, config.heartbeat.intervalMs);
  return { stop: () => clearInterval(timer) };
}
