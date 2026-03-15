import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxHandle } from "@clawrun/agent";
import type { RuntimeConfig, SandboxLifecycleManager as SLMType } from "@clawrun/runtime";
import type { SandboxProvider } from "@clawrun/provider";

vi.mock("@clawrun/runtime", () => ({
  SandboxLifecycleManager: vi.fn().mockImplementation(
    class {
      getStatus = vi.fn(async () => ({ running: true, sandboxId: "sbx-1" }));
    },
  ),
  getRuntimeConfig: vi.fn(() => ({
    instance: { provider: "vercel" },
  })),
  resolveRoot: vi.fn(async () => "/home/user/.clawrun"),
}));

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(() => ({
    get: vi.fn(async () => mockSandbox),
  })),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

let mockSandbox: Partial<SandboxHandle>;

function applyRuntimeMocks() {
  return import("@clawrun/runtime").then((runtimeMod) => {
    vi.mocked(runtimeMod.getRuntimeConfig).mockReturnValue({
      instance: { provider: "vercel" },
    } as RuntimeConfig);
    vi.mocked(runtimeMod.resolveRoot).mockResolvedValue("/home/user/.clawrun");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      class {
        getStatus = vi.fn(async () => ({ running: true, sandboxId: "sbx-1", status: "running" }));
      } as unknown as typeof SLMType,
    );
  });
}

function applyProviderMock() {
  return import("@clawrun/provider").then((providerMod) => {
    vi.mocked(providerMod.getProvider).mockReturnValue({
      get: vi.fn(async () => mockSandbox),
    } as unknown as SandboxProvider);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSandbox = {
    readFile: vi.fn(),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () =>
        "/home/user/.clawrun/agent/workspace/AGENTS.md\n/home/user/.clawrun/agent/workspace/SOUL.md\n",
      stderr: async () => "",
    })),
  };
});

// ---------------------------------------------------------------------------
// handleListWorkspaceFiles
// ---------------------------------------------------------------------------

describe("handleListWorkspaceFiles", () => {
  let handleListWorkspaceFiles: typeof import("./workspace-files.js").handleListWorkspaceFiles;

  beforeEach(async () => {
    vi.resetModules();
    await applyRuntimeMocks();
    await applyProviderMock();
    const mod = await import("./workspace-files.js");
    handleListWorkspaceFiles = mod.handleListWorkspaceFiles;
  });

  it("returns 503 when sandbox is offline", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      class {
        getStatus = vi.fn(async () => ({ running: false, sandboxId: null }));
      } as unknown as typeof SLMType,
    );

    const resp = await handleListWorkspaceFiles();
    expect(resp.status).toBe(503);
  });

  it("returns sorted file list", async () => {
    const resp = await handleListWorkspaceFiles();
    const body = await resp.json();

    expect(body.files).toHaveLength(2);
    expect(body.files[0].name).toBe("AGENTS.md");
    expect(body.files[1].name).toBe("SOUL.md");
  });

  it("returns empty when no .md files found", async () => {
    vi.mocked(mockSandbox.runCommand!).mockResolvedValue({
      exitCode: 0,
      stdout: async () => "",
      stderr: async () => "",
    });

    const resp = await handleListWorkspaceFiles();
    const body = await resp.json();

    expect(body.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleGetWorkspaceFile
// ---------------------------------------------------------------------------

describe("handleGetWorkspaceFile", () => {
  let handleGetWorkspaceFile: typeof import("./workspace-files.js").handleGetWorkspaceFile;

  beforeEach(async () => {
    vi.resetModules();
    await applyRuntimeMocks();
    await applyProviderMock();
    const mod = await import("./workspace-files.js");
    handleGetWorkspaceFile = mod.handleGetWorkspaceFile;
  });

  it("returns 503 when sandbox is offline", async () => {
    const runtimeMod = await import("@clawrun/runtime");
    vi.mocked(runtimeMod.SandboxLifecycleManager).mockImplementation(
      class {
        getStatus = vi.fn(async () => ({ running: false, sandboxId: null }));
      } as unknown as typeof SLMType,
    );

    const req = new Request("http://localhost/api/v1/workspace/AGENTS.md");
    const resp = await handleGetWorkspaceFile(req, {
      params: Promise.resolve({ name: "AGENTS.md" }),
    });
    expect(resp.status).toBe(503);
  });

  it("returns file content", async () => {
    vi.mocked(mockSandbox.readFile!).mockResolvedValue(
      Buffer.from("# Agents\nThis is the agents file."),
    );

    const req = new Request("http://localhost/api/v1/workspace/AGENTS.md");
    const resp = await handleGetWorkspaceFile(req, {
      params: Promise.resolve({ name: "AGENTS.md" }),
    });
    const body = await resp.json();

    expect(body.name).toBe("AGENTS.md");
    expect(body.content).toBe("# Agents\nThis is the agents file.");
  });

  it("returns 404 when file does not exist", async () => {
    vi.mocked(mockSandbox.readFile!).mockResolvedValue(null);

    const req = new Request("http://localhost/api/v1/workspace/MISSING.md");
    const resp = await handleGetWorkspaceFile(req, {
      params: Promise.resolve({ name: "MISSING.md" }),
    });
    expect(resp.status).toBe(404);
  });

  it("rejects names without .md extension", async () => {
    const req = new Request("http://localhost/api/v1/workspace/config.toml");
    const resp = await handleGetWorkspaceFile(req, {
      params: Promise.resolve({ name: "config.toml" }),
    });
    expect(resp.status).toBe(400);
  });

  it("rejects path traversal with ..", async () => {
    const req = new Request("http://localhost/api/v1/workspace/..%2F..%2Fetc%2Fpasswd.md");
    const resp = await handleGetWorkspaceFile(req, {
      params: Promise.resolve({ name: "../../etc/passwd.md" }),
    });
    expect(resp.status).toBe(400);
  });

  it("rejects names with slashes", async () => {
    const req = new Request("http://localhost/api/v1/workspace/sub/file.md");
    const resp = await handleGetWorkspaceFile(req, {
      params: Promise.resolve({ name: "sub/file.md" }),
    });
    expect(resp.status).toBe(400);
  });
});
