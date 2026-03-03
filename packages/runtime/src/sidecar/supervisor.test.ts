import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { SidecarConfig, SidecarState } from "./types.js";

vi.mock("./log.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  }),
}));

// Track all created sockets so tests can control them
let sockets: EventEmitter[] = [];

vi.mock("node:net", () => ({
  createConnection: vi.fn(() => {
    const sock = new EventEmitter();
    (sock as any).destroy = vi.fn();
    sockets.push(sock);
    return sock;
  }),
}));

// Track all spawned children
let children: (EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
})[] = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as any;
    child.pid = 1234 + children.length;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    children.push(child);
    return child;
  }),
}));

import { createConnection } from "node:net";

function makeConfig(overrides: Partial<SidecarConfig["daemon"]> = {}): SidecarConfig {
  return {
    daemon: {
      cmd: "/usr/bin/agent",
      args: ["serve", "--port", "3000"],
      env: {},
      port: 3000,
      readyTimeout: 5000,
      ...overrides,
    },
    heartbeat: { url: "http://localhost/heartbeat", sandboxId: "sbx-1", intervalMs: 60000 },
    monitor: { dir: "/workspace", ignoreFiles: [] },
    health: { port: 3001 },
    root: "/root",
  };
}

function makeState(): SidecarState {
  return {
    daemonPid: null,
    daemonStatus: "stopped",
    daemonRestarts: 0,
    lastHeartbeatTick: 0,
    lastHeartbeatSuccess: false,
    lastMtime: 0,
    lastChangedAt: 0,
    createdAt: Date.now(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  sockets = [];
  children = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("superviseDaemon", () => {
  // Must dynamically import after mocks are set up
  let superviseDaemon: typeof import("./supervisor.js").superviseDaemon;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./supervisor.js");
    superviseDaemon = mod.superviseDaemon;
  });

  it("spawns daemon and transitions to running on port probe success", async () => {
    const state = makeState();
    superviseDaemon(makeConfig(), state);

    expect(state.daemonStatus).toBe("starting");
    expect(children.length).toBe(1);

    // Simulate port probe success
    await vi.advanceTimersByTimeAsync(0);
    const sock = sockets[0];
    sock.emit("connect");

    await vi.advanceTimersByTimeAsync(0);
    expect(state.daemonStatus).toBe("running");
    expect(state.daemonPid).toBe(children[0].pid);
  });

  it("restarts daemon when it exits", async () => {
    const state = makeState();
    superviseDaemon(makeConfig(), state);

    // Port probe succeeds
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].emit("connect");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.daemonStatus).toBe("running");

    // Daemon exits
    children[0].emit("exit", 1, null);
    expect(state.daemonStatus).toBe("stopped");
    expect(state.daemonRestarts).toBe(1);

    // After RESTART_DELAY_MS (2000ms), a new child is spawned
    await vi.advanceTimersByTimeAsync(2000);
    expect(children.length).toBe(2);
    expect(state.daemonStatus).toBe("starting");
  });

  it("transitions to failed after MAX_RESTARTS (5)", async () => {
    const state = makeState();
    state.daemonRestarts = 5;
    superviseDaemon(makeConfig(), state);

    // Should not spawn — already at max restarts
    expect(children.length).toBe(0);
    expect(state.daemonStatus).toBe("failed");
  });

  it("resets restart counter after STABLE_RESET_MS (60s) of running", async () => {
    const state = makeState();
    state.daemonRestarts = 3;
    superviseDaemon(makeConfig(), state);

    // Port probe success
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].emit("connect");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.daemonStatus).toBe("running");
    expect(state.daemonRestarts).toBe(3);

    // After 60s stable running, restarts reset
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.daemonRestarts).toBe(0);
  });

  it("does not reset restart counter if daemon stopped before STABLE_RESET_MS", async () => {
    const state = makeState();
    state.daemonRestarts = 2;
    superviseDaemon(makeConfig(), state);

    // Port probe success
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].emit("connect");
    await vi.advanceTimersByTimeAsync(0);

    // Daemon exits after 10s (before 60s stable reset)
    await vi.advanceTimersByTimeAsync(10_000);
    children[0].emit("exit", 1, null);

    // Even after 60s total, counter should NOT be reset (daemon wasn't running)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.daemonRestarts).toBe(3); // was 2, +1 for the exit
  });

  it("shutdown sends SIGTERM and resolves", async () => {
    const state = makeState();
    const { shutdown } = superviseDaemon(makeConfig(), state);

    // Port probe success
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].emit("connect");
    await vi.advanceTimersByTimeAsync(0);

    const done = shutdown();
    expect(children[0].kill).toHaveBeenCalledWith("SIGTERM");

    // Simulate daemon exit after SIGTERM
    children[0].emit("exit", 0, "SIGTERM");
    await done;

    // Should not restart after shutdown
    await vi.advanceTimersByTimeAsync(5000);
    expect(children.length).toBe(1);
  });

  it("shutdown resolves immediately when no child is running", async () => {
    const state = makeState();
    state.daemonRestarts = 5; // won't spawn
    const { shutdown } = superviseDaemon(makeConfig(), state);
    await shutdown(); // should not hang
  });

  it("shutdown resolves after timeout if daemon doesn't exit", async () => {
    const state = makeState();
    const { shutdown } = superviseDaemon(makeConfig(), state);

    await vi.advanceTimersByTimeAsync(0);
    sockets[0].emit("connect");
    await vi.advanceTimersByTimeAsync(0);

    const done = shutdown();
    // Don't emit exit — let the 5s timeout fire
    await vi.advanceTimersByTimeAsync(5000);
    await done;
  });

  it("handles spawn error by incrementing restarts", async () => {
    const state = makeState();
    superviseDaemon(makeConfig(), state);

    children[0].emit("error", new Error("ENOENT"));
    expect(state.daemonRestarts).toBe(1);
    expect(state.daemonStatus).toBe("stopped");
  });

  it("retries port probe until success", async () => {
    const state = makeState();
    superviseDaemon(makeConfig(), state);

    // First probe fails
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].emit("error");

    // Wait PROBE_INTERVAL_MS (500ms), second probe succeeds
    await vi.advanceTimersByTimeAsync(500);
    sockets[1].emit("connect");

    await vi.advanceTimersByTimeAsync(0);
    expect(state.daemonStatus).toBe("running");
  });
});
