import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ToolConfig } from "./types.js";

vi.mock("./log.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Track spawned children
let children: Array<{
  on: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
}> = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const handlers: Record<string, Function> = {};
    const child = {
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
      emit: (event: string, ...args: unknown[]) => {
        handlers[event]?.(...args);
      },
    };
    children.push(child);
    return child;
  }),
}));

function makeTool(overrides?: Partial<ToolConfig>): ToolConfig {
  return {
    id: "test-tool",
    check: { cmd: "which", args: ["test-tool"] },
    install: [{ cmd: "apt-get", args: ["install", "-y", "test-tool"] }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  children = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("installTools", () => {
  let installTools: typeof import("./tools.js").installTools;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./tools.js");
    installTools = mod.installTools;
  });

  it("does nothing for empty tools array", async () => {
    await installTools([]);
    expect(children).toHaveLength(0);
  });

  it("skips already-installed tools", async () => {
    const tool = makeTool();
    const promise = installTools([tool]);

    // check command (which test-tool) succeeds → exit 0
    children[0].emit("exit", 0);
    await promise;

    // Only the check command was spawned, no install
    expect(children).toHaveLength(1);
  });

  it("installs tool when check fails", async () => {
    const tool = makeTool();
    const promise = installTools([tool]);

    // check fails → exit 1
    children[0].emit("exit", 1);

    // install step spawned
    await vi.advanceTimersByTimeAsync(0);
    children[1].emit("exit", 0);

    await promise;
    expect(children).toHaveLength(2);
  });

  it("runs multi-step install sequentially", async () => {
    const tool = makeTool({
      install: [
        { cmd: "curl", args: ["-o", "/tmp/installer.sh", "https://example.com/install.sh"] },
        { cmd: "sh", args: ["/tmp/installer.sh"] },
      ],
    });

    const promise = installTools([tool]);

    // check fails
    children[0].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(0);

    // step 1 succeeds
    children[1].emit("exit", 0);
    await vi.advanceTimersByTimeAsync(0);

    // step 2 succeeds
    children[2].emit("exit", 0);

    await promise;
    expect(children).toHaveLength(3);
  });

  it("retries on install failure up to 3 times", async () => {
    const tool = makeTool();
    const promise = installTools([tool]);

    // check fails
    children[0].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(0);

    // attempt 1 fails
    children[1].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(5000);

    // attempt 2 fails
    children[2].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(5000);

    // attempt 3 fails
    children[3].emit("exit", 1);

    // Should not throw — continues without the tool
    await promise;
    // 1 check + 3 install attempts = 4 children
    expect(children).toHaveLength(4);
  });

  it("succeeds on retry after initial failure", async () => {
    const tool = makeTool();
    const promise = installTools([tool]);

    // check fails
    children[0].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(0);

    // attempt 1 fails
    children[1].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(5000);

    // attempt 2 succeeds
    children[2].emit("exit", 0);

    await promise;
    // 1 check + 2 install attempts = 3
    expect(children).toHaveLength(3);
  });

  it("handles spawn error during check", async () => {
    const tool = makeTool();
    const promise = installTools([tool]);

    // check command errors
    children[0].emit("error", new Error("ENOENT"));

    // Should reject
    await expect(promise).rejects.toThrow();
  });

  it("processes multiple tools sequentially", async () => {
    const tool1 = makeTool({ id: "tool-1" });
    const tool2 = makeTool({ id: "tool-2" });
    const promise = installTools([tool1, tool2]);

    // tool1 check → installed
    children[0].emit("exit", 0);
    await vi.advanceTimersByTimeAsync(0);

    // tool2 check → needs install
    children[1].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(0);

    // tool2 install succeeds
    children[2].emit("exit", 0);

    await promise;
    expect(children).toHaveLength(3);
  });
});
