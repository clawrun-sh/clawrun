import { readFileSync } from "node:fs";
import type { SidecarConfig, SidecarState } from "./types.js";
import { initLogger, createLogger } from "./log.js";
import { startHealthServer } from "./health.js";
import { superviseDaemon } from "./supervisor.js";
import { startHeartbeat } from "./heartbeat.js";
import { installTools } from "./tools.js";

function main(): void {
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

  // Initialize logger before anything else
  initLogger(config.root);
  const log = createLogger("sidecar");

  process.on("unhandledRejection", (err) => {
    log.error(`unhandled rejection: ${err instanceof Error ? err.message : String(err)}`);
  });

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

  log.info(
    `starting: daemon=${config.daemon.cmd}, ` +
      `heartbeat=${config.heartbeat.url}, ` +
      `health=:${config.health.port}`,
  );

  // Merge tool runtime env vars into daemon env (resolve $HOME placeholders)
  // Also add ~/.local/bin to PATH so the daemon can find tool binaries.
  if (config.tools && config.tools.length > 0) {
    const home = process.env.HOME ?? "/root";
    config.daemon.env.PATH = `${home}/.clawrun/bin:${home}/.local/bin:${process.env.PATH ?? ""}`;
    for (const tool of config.tools) {
      if (tool.env) {
        for (const [key, value] of Object.entries(tool.env)) {
          config.daemon.env[key] = value.replace(/\$HOME/g, home);
        }
      }
    }
  }

  // 1. Health server first — so parent can poll immediately
  startHealthServer(config, state);

  // 2. Daemon supervisor
  const supervisor = superviseDaemon(config, state);

  // 3. Heartbeat loop
  const heartbeat = startHeartbeat(config, state);

  // 4. Install tools in background (non-blocking)
  if (config.tools && config.tools.length > 0) {
    installTools(config.tools);
  }

  // Graceful shutdown — stop restarting daemon, drain heartbeat, exit
  process.on("SIGTERM", async () => {
    log.info("SIGTERM received, shutting down");
    heartbeat.stop();
    await supervisor.shutdown();
    process.exit(0);
  });
}

// Entry guard
if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("sidecar/index.js")) {
  main();
}
