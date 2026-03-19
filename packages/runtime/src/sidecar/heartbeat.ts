import { getMaxMtime } from "./mtime.js";
import type { SidecarConfig, SidecarState } from "./types.js";
import type { ExtendResult } from "../sandbox/lifecycle.js";
import { createLogger } from "./log.js";

let log: ReturnType<typeof createLogger>;
function getLog() {
  if (!log) log = createLogger("heartbeat");
  return log;
}

function formatResult(result: ExtendResult): string {
  switch (result.action) {
    case "extended": {
      const parts = ["Session extended"];
      if (result.reason) parts.push(result.reason);
      if (result.remainingSeconds != null) {
        const mins = Math.floor(result.remainingSeconds / 60);
        const secs = result.remainingSeconds % 60;
        parts.push(`${mins}m${secs}s remaining`);
      }
      return parts.join(", ");
    }
    case "stopped": {
      const parts = ["Sandbox stopping"];
      if (result.reason) parts.push(result.reason);
      if (result.nextWakeAt) parts.push(`next wake: ${result.nextWakeAt}`);
      return parts.join(", ");
    }
    case "error":
      return `Heartbeat error: ${result.error ?? "unknown"}`;
  }
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
      try {
        const result: ExtendResult = await res.json();
        getLog().info(formatResult(result));
      } catch {
        getLog().info("Heartbeat acknowledged");
      }
    } else {
      state.lastHeartbeatSuccess = false;
      getLog().error(`Heartbeat failed (HTTP ${res.status}): ${await res.text()}`);
    }
    state.lastHeartbeatTick = Date.now();
  } catch (err: unknown) {
    state.lastHeartbeatSuccess = false;
    state.lastHeartbeatTick = Date.now();
    const message = err instanceof Error ? err.message : String(err);
    getLog().error(`Heartbeat failed: ${message}`);
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
      getLog().error("Heartbeat tick failed: %o", err);
    });
  };

  safeTick();
  const timer = setInterval(safeTick, config.heartbeat.intervalMs);
  return { stop: () => clearInterval(timer) };
}
