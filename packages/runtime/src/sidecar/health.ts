import { createServer } from "node:http";
import type { SidecarState, SidecarConfig } from "./types.js";

export function startHealthServer(config: SidecarConfig, state: SidecarState): void {
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const body = JSON.stringify({
        ok: state.daemonStatus === "running" || state.daemonStatus === "starting",
        daemon: {
          status: state.daemonStatus,
          pid: state.daemonPid,
          restarts: state.daemonRestarts,
        },
        heartbeat: {
          lastTick: state.lastHeartbeatTick,
          lastSuccess: state.lastHeartbeatSuccess,
        },
        uptime: Math.round((Date.now() - state.createdAt) / 1000),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(config.health.port, "0.0.0.0", () => {
    console.log(`[sidecar] health server listening on port ${config.health.port}`);
  });
}
