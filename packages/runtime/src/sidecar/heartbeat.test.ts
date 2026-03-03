import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SidecarConfig, SidecarState } from "./types.js";

vi.mock("./log.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("./mtime.js", () => ({
  getMaxMtime: vi.fn(() => 0),
}));

import { getMaxMtime } from "./mtime.js";

function makeConfig(): SidecarConfig {
  return {
    daemon: {
      cmd: "/usr/bin/agent",
      args: [],
      env: {},
      port: 3000,
      readyTimeout: 5000,
    },
    heartbeat: {
      url: "http://localhost/api/v1/sandbox/heartbeat",
      sandboxId: "sbx-1",
      intervalMs: 60000,
    },
    monitor: { dir: "/workspace", ignoreFiles: [".git"] },
    health: { port: 3001 },
    root: "/home/user/.clawrun",
  };
}

function makeState(): SidecarState {
  return {
    daemonPid: 1234,
    daemonStatus: "running",
    daemonRestarts: 0,
    lastHeartbeatTick: 0,
    lastHeartbeatSuccess: false,
    lastMtime: 0,
    lastChangedAt: 1000,
    createdAt: 900,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.CLAWRUN_HB_SECRET;
});

describe("startHeartbeat", () => {
  let startHeartbeat: typeof import("./heartbeat.js").startHeartbeat;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./heartbeat.js");
    startHeartbeat = mod.startHeartbeat;
  });

  it("returns no-op when CLAWRUN_HB_SECRET is not set", () => {
    delete process.env.CLAWRUN_HB_SECRET;
    const { stop } = startHeartbeat(makeConfig(), makeState());
    // Should not throw and should not call fetch
    stop();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fires heartbeat tick immediately on start", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const state = makeState();
    const { stop } = startHeartbeat(makeConfig(), state);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    stop();
  });

  it("sends POST with correct payload and auth header", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const state = makeState();
    const { stop } = startHeartbeat(makeConfig(), state);

    await vi.advanceTimersByTimeAsync(0);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://localhost/api/v1/sandbox/heartbeat");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-secret");

    const body = JSON.parse(opts.body);
    expect(body.sandboxId).toBe("sbx-1");
    expect(body.root).toBe("/home/user/.clawrun");
    expect(body.daemonStatus).toBe("running");
    stop();
  });

  it("updates lastChangedAt when mtime changes", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const state = makeState();
    state.lastMtime = 100;
    state.lastChangedAt = 500;

    // mtime changed since last check
    vi.mocked(getMaxMtime).mockReturnValue(200);

    const { stop } = startHeartbeat(makeConfig(), state);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.lastMtime).toBe(200);
    expect(state.lastChangedAt).toBeGreaterThan(500);
    stop();
  });

  it("does not update lastChangedAt when mtime is unchanged", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const state = makeState();
    state.lastMtime = 100;
    state.lastChangedAt = 500;

    vi.mocked(getMaxMtime).mockReturnValue(100); // same as lastMtime

    const { stop } = startHeartbeat(makeConfig(), state);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.lastChangedAt).toBe(500); // unchanged
    stop();
  });

  it("sets lastHeartbeatSuccess to true on 200 response", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const state = makeState();
    fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));

    const { stop } = startHeartbeat(makeConfig(), state);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.lastHeartbeatSuccess).toBe(true);
    expect(state.lastHeartbeatTick).toBeGreaterThan(0);
    stop();
  });

  it("sets lastHeartbeatSuccess to false on non-200 response", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const state = makeState();
    fetchSpy.mockResolvedValue(new Response("error", { status: 500 }));

    const { stop } = startHeartbeat(makeConfig(), state);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.lastHeartbeatSuccess).toBe(false);
    stop();
  });

  it("sets lastHeartbeatSuccess to false on fetch error", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const state = makeState();
    fetchSpy.mockRejectedValue(new Error("network error"));

    const { stop } = startHeartbeat(makeConfig(), state);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.lastHeartbeatSuccess).toBe(false);
    expect(state.lastHeartbeatTick).toBeGreaterThan(0);
    stop();
  });

  it("fires tick at intervalMs", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const config = makeConfig();
    config.heartbeat.intervalMs = 10_000;
    const { stop } = startHeartbeat(config, makeState());

    await vi.advanceTimersByTimeAsync(0); // initial tick
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000); // second tick
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    stop();
  });

  it("stop prevents further ticks", async () => {
    process.env.CLAWRUN_HB_SECRET = "test-secret";
    const config = makeConfig();
    config.heartbeat.intervalMs = 10_000;
    const { stop } = startHeartbeat(config, makeState());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    stop();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no more ticks
  });
});
