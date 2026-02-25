import { readFileSync } from "node:fs";
import type { SidecarConfig, SidecarState } from "./types.js";
import { startHealthServer } from "./health.js";
import { superviseDaemon } from "./supervisor.js";
import { startHeartbeat } from "./heartbeat.js";

function main(): void {
  process.on("unhandledRejection", (err) => {
    console.error("[sidecar] unhandled rejection:", err);
  });

  const configPath = process.argv[2];
  if (!configPath) {
    console.error("[sidecar] Usage: node index.js <config.json>");
    process.exit(1);
  }

  if (!process.env.CLAWRUN_HB_SECRET) {
    console.error("[sidecar] CLAWRUN_HB_SECRET env var required");
    process.exit(1);
  }

  const config: SidecarConfig = JSON.parse(readFileSync(configPath, "utf-8"));

  const state: SidecarState = {
    daemonPid: null,
    daemonStatus: "stopped",
    daemonRestarts: 0,
    lastHeartbeatTick: 0,
    lastHeartbeatSuccess: false,
    lastMtime: 0,
    lastChangedAt: Date.now(),
    createdAt: Date.now(),
  };

  console.log(
    `[sidecar] starting: daemon=${config.daemon.cmd}, ` +
      `heartbeat=${config.heartbeat.url}, ` +
      `health=:${config.health.port}`,
  );

  // 1. Health server first — so parent can poll immediately
  startHealthServer(config, state);

  // 2. Daemon supervisor
  const supervisor = superviseDaemon(config, state);

  // 3. Heartbeat loop
  const heartbeat = startHeartbeat(config, state);

  // Graceful shutdown — stop restarting daemon, drain heartbeat, exit
  process.on("SIGTERM", () => {
    console.log("[sidecar] SIGTERM received, shutting down");
    supervisor.shutdown();
    heartbeat.stop();
    setTimeout(() => process.exit(0), 1000);
  });
}

// Entry guard
if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("sidecar/index.js")) {
  main();
}
