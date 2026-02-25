import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import type { SidecarConfig, SidecarState } from "./types.js";

const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 2000;
const PROBE_INTERVAL_MS = 500;
const STABLE_RESET_MS = 60_000;

/** Try a TCP connect to port. Resolves true if the port accepts connections. */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 1000);
    sock.on("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export function superviseDaemon(
  config: SidecarConfig,
  state: SidecarState,
): { shutdown(): Promise<void> } {
  let shuttingDown = false;
  let currentChild: ReturnType<typeof spawn> | null = null;

  function launch(): void {
    if (shuttingDown) return;

    if (state.daemonRestarts >= MAX_RESTARTS) {
      console.error(`[sidecar:supervisor] daemon failed after ${MAX_RESTARTS} restarts, giving up`);
      state.daemonStatus = "failed";
      return;
    }

    state.daemonStatus = "starting";
    console.log(
      `[sidecar:supervisor] spawning: ${config.daemon.cmd} ${config.daemon.args.join(" ")}` +
        (state.daemonRestarts > 0 ? ` (restart #${state.daemonRestarts})` : ""),
    );

    const child = spawn(config.daemon.cmd, config.daemon.args, {
      env: { ...process.env, ...config.daemon.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    currentChild = child;
    state.daemonPid = child.pid ?? null;
    let exited = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[daemon:out] ${chunk}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[daemon:err] ${chunk}`);
    });

    // Probe daemon port to confirm it's actually listening
    (async () => {
      const start = Date.now();
      let warned = false;
      while (!exited && !shuttingDown && state.daemonStatus === "starting") {
        if (await probePort(config.daemon.port)) {
          if (state.daemonStatus === "starting") {
            state.daemonStatus = "running";
            // Reset restart counter after stable running
            setTimeout(() => {
              if (state.daemonStatus === "running" && state.daemonPid === child.pid) {
                state.daemonRestarts = 0;
              }
            }, STABLE_RESET_MS);
            console.log(
              `[sidecar:supervisor] daemon running` +
                ` (pid=${state.daemonPid}, port=${config.daemon.port}, ready in ${Date.now() - start}ms)`,
            );
          }
          return;
        }
        if (!warned && Date.now() - start > config.daemon.readyTimeout) {
          console.warn(
            `[sidecar:supervisor] daemon not ready after ${config.daemon.readyTimeout}ms, still probing`,
          );
          warned = true;
        }
        await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
      }
    })();

    function handleExit(code: number | null, signal: string | null): void {
      if (exited) return;
      exited = true;

      console.log(`[sidecar:supervisor] daemon exited (code=${code}, signal=${signal})`);

      if (currentChild === child) currentChild = null;
      state.daemonPid = null;
      state.daemonStatus = "stopped";

      // Don't restart during graceful shutdown
      if (shuttingDown) return;

      state.daemonRestarts++;
      setTimeout(launch, RESTART_DELAY_MS);
    }

    child.on("error", (err) => {
      console.error(`[sidecar:supervisor] spawn error: ${err.message}`);
      handleExit(null, null);
    });

    child.on("exit", (code, signal) => {
      handleExit(code, signal);
    });
  }

  launch();

  return {
    shutdown(): Promise<void> {
      shuttingDown = true;
      if (!currentChild) return Promise.resolve();
      return new Promise((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        currentChild!.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        currentChild!.kill("SIGTERM");
      });
    },
  };
}
