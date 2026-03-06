import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClawRunInstance, SandboxEntry } from "@clawrun/sdk";

// Stub clack spinner to avoid TTY issues in tests
const mockSpinner = {
  start: vi.fn(),
  stop: vi.fn(),
  message: vi.fn(),
};
vi.mock("@clack/prompts", () => ({
  spinner: () => mockSpinner,
  log: { info: vi.fn(), error: vi.fn() },
}));

// Prevent process.exit from killing the test runner
const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
  throw new Error("process.exit called");
}) as never);

import { getRunningId, resolveRunningId } from "./resolve.js";

// --- Helpers ---

function makeSandbox(overrides: Partial<SandboxEntry> = {}): SandboxEntry {
  return {
    id: "sbx_default" as SandboxEntry["id"],
    status: "stopped",
    createdAt: Date.now(),
    memory: 512,
    vcpus: 1,
    ...overrides,
  };
}

function makeInstance(sandboxes: SandboxEntry[]): ClawRunInstance {
  const listFn = vi.fn().mockResolvedValue(sandboxes);
  const startFn = vi.fn().mockResolvedValue({ status: "running" });
  return {
    sandbox: {
      list: listFn,
      stop: vi.fn(),
      listSnapshots: vi.fn(),
      deleteSnapshots: vi.fn(),
      exec: vi.fn(),
      readFile: vi.fn(),
    },
    start: startFn,
    stop: vi.fn(),
    restart: vi.fn(),
    health: vi.fn(),
    chat: vi.fn(),
    sendMessage: vi.fn(),
    getHistory: vi.fn(),
    createInvite: vi.fn(),
    destroySandboxes: vi.fn(),
    webUrl: "https://example.com",
  } as unknown as ClawRunInstance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExit.mockClear();

  // Stub setTimeout to fire callbacks instantly (avoids 3s poll delay in resolve code)
  const _realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal("setTimeout", (fn: () => void, _ms?: number) => {
    return _realSetTimeout(() => fn(), 0);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- getRunningId ---

describe("getRunningId", () => {
  it("returns null when no sandboxes exist", async () => {
    const instance = makeInstance([]);
    expect(await getRunningId(instance)).toBeNull();
  });

  it("returns null when all sandboxes are stopped", async () => {
    const instance = makeInstance([
      makeSandbox({ id: "sbx_1" as SandboxEntry["id"], status: "stopped" }),
      makeSandbox({ id: "sbx_2" as SandboxEntry["id"], status: "stopping" }),
    ]);
    expect(await getRunningId(instance)).toBeNull();
  });

  it("returns the running sandbox id", async () => {
    const instance = makeInstance([
      makeSandbox({ id: "sbx_1" as SandboxEntry["id"], status: "stopped" }),
      makeSandbox({ id: "sbx_2" as SandboxEntry["id"], status: "running" }),
    ]);
    expect(await getRunningId(instance)).toBe("sbx_2");
  });

  it("returns the first running sandbox when multiple are running", async () => {
    const instance = makeInstance([
      makeSandbox({ id: "sbx_1" as SandboxEntry["id"], status: "running" }),
      makeSandbox({ id: "sbx_2" as SandboxEntry["id"], status: "running" }),
    ]);
    expect(await getRunningId(instance)).toBe("sbx_1");
  });
});

// --- resolveRunningId ---

describe("resolveRunningId", () => {
  it("returns immediately when a running sandbox exists", async () => {
    const instance = makeInstance([
      makeSandbox({ id: "sbx_live" as SandboxEntry["id"], status: "running" }),
    ]);

    const id = await resolveRunningId(instance);

    expect(id).toBe("sbx_live");
    // Should NOT have called start
    expect(instance.start).not.toHaveBeenCalled();
  });

  it("calls instance.start() when no sandbox is running", async () => {
    const instance = makeInstance([]);
    (instance.sandbox.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // initial check
      .mockResolvedValueOnce([
        makeSandbox({ id: "sbx_woke" as SandboxEntry["id"], status: "running" }),
      ]); // after start

    const id = await resolveRunningId(instance, mockSpinner as never);

    expect(id).toBe("sbx_woke");
    expect(instance.start).toHaveBeenCalled();
  });

  it("uses the caller's spinner instead of creating a new one", async () => {
    const instance = makeInstance([]);
    (instance.sandbox.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeSandbox({ id: "sbx_1" as SandboxEntry["id"], status: "running" }),
      ]);

    await resolveRunningId(instance, mockSpinner as never);

    // Spinner.message should be called (not start — caller already started it)
    expect(mockSpinner.message).toHaveBeenCalledWith("Starting sandbox...");
  });

  it("exits on network error reaching deployment", async () => {
    const instance = makeInstance([]);
    (instance.sandbox.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (instance.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(resolveRunningId(instance, mockSpinner as never)).rejects.toThrow(
      "process.exit called",
    );

    expect(mockSpinner.stop).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
  });

  it("exits when start returns failed status", async () => {
    const instance = makeInstance([]);
    (instance.sandbox.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (instance.start as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed",
      error: "Unauthorized",
    });

    await expect(resolveRunningId(instance, mockSpinner as never)).rejects.toThrow(
      "process.exit called",
    );

    expect(mockSpinner.stop).toHaveBeenCalledWith(expect.stringContaining("Unauthorized"));
  });
});
