import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SandboxClient, SandboxEntry } from "./types.js";

// --- Mocks ---

const mockPost = vi.fn();
vi.mock("../api.js", () => ({
  createApiClient: () => ({ post: mockPost, get: vi.fn() }),
}));

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
    id: "sbx_default",
    status: "stopped",
    createdAt: Date.now(),
    memory: 512,
    vcpus: 1,
    ...overrides,
  };
}

function makeClient(sandboxes: SandboxEntry[]): SandboxClient {
  return {
    list: vi.fn().mockResolvedValue(sandboxes),
    stop: vi.fn(),
    listSnapshots: vi.fn(),
    deleteSnapshots: vi.fn(),
    exec: vi.fn(),
    readFile: vi.fn(),
    connect: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExit.mockClear();

  // Stub setTimeout to fire callbacks instantly (avoids 3s poll delay in resolve code)
  const _realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal("setTimeout", (fn: Function, _ms?: number) => {
    return _realSetTimeout(() => fn(), 0);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- getRunningId ---

describe("getRunningId", () => {
  it("returns null when no sandboxes exist", async () => {
    const client = makeClient([]);
    expect(await getRunningId(client)).toBeNull();
  });

  it("returns null when all sandboxes are stopped", async () => {
    const client = makeClient([
      makeSandbox({ id: "sbx_1", status: "stopped" }),
      makeSandbox({ id: "sbx_2", status: "stopping" }),
    ]);
    expect(await getRunningId(client)).toBeNull();
  });

  it("returns the running sandbox id", async () => {
    const client = makeClient([
      makeSandbox({ id: "sbx_1", status: "stopped" }),
      makeSandbox({ id: "sbx_2", status: "running" }),
    ]);
    expect(await getRunningId(client)).toBe("sbx_2");
  });

  it("returns the first running sandbox when multiple are running", async () => {
    const client = makeClient([
      makeSandbox({ id: "sbx_1", status: "running" }),
      makeSandbox({ id: "sbx_2", status: "running" }),
    ]);
    expect(await getRunningId(client)).toBe("sbx_1");
  });
});

// --- resolveRunningId ---

describe("resolveRunningId", () => {
  it("returns immediately when a running sandbox exists", async () => {
    const client = makeClient([makeSandbox({ id: "sbx_live", status: "running" })]);

    const id = await resolveRunningId(client, "https://example.com", "secret123");

    expect(id).toBe("sbx_live");
    // Should NOT have called the start API
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("calls /api/v1/sandbox/start (not /restart) when no sandbox is running", async () => {
    // First list() → no running, then after start → running
    const client = makeClient([]);
    (client.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // initial check
      .mockResolvedValueOnce([makeSandbox({ id: "sbx_woke", status: "running" })]); // after start

    mockPost.mockResolvedValue({ ok: true });

    const id = await resolveRunningId(
      client,
      "https://example.com",
      "jwt-secret",
      mockSpinner as never,
    );

    expect(id).toBe("sbx_woke");
    expect(mockPost).toHaveBeenCalledWith(
      "/api/v1/sandbox/start",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // Verify it's /start, not /restart
    expect(mockPost).not.toHaveBeenCalledWith("/api/v1/sandbox/restart", expect.anything());
  });

  it("uses the caller's spinner instead of creating a new one", async () => {
    const client = makeClient([]);
    (client.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeSandbox({ id: "sbx_1", status: "running" })]);
    mockPost.mockResolvedValue({ ok: true });

    await resolveRunningId(client, "https://example.com", "secret", mockSpinner as never);

    // Spinner.message should be called (not start — caller already started it)
    expect(mockSpinner.message).toHaveBeenCalledWith("Starting sandbox...");
  });

  it("exits on network error reaching deployment", async () => {
    const client = makeClient([]);
    (client.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockPost.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      resolveRunningId(client, "https://example.com", "secret", mockSpinner as never),
    ).rejects.toThrow("process.exit called");

    expect(mockSpinner.stop).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
  });

  it("exits on non-ok HTTP response from start endpoint", async () => {
    const client = makeClient([]);
    (client.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockPost.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(
      resolveRunningId(client, "https://example.com", "secret", mockSpinner as never),
    ).rejects.toThrow("process.exit called");

    expect(mockSpinner.stop).toHaveBeenCalledWith(expect.stringContaining("401"));
  });
});
