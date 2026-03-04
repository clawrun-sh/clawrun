import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("node:module", () => ({
  createRequire: () => ({
    resolve: () => "/node_modules/sandbox/package.json",
  }),
}));

import { ProviderSandboxClient } from "./client.js";
import type { SandboxProvider, ManagedSandbox, SandboxInfo } from "@clawrun/provider";
import type { PlatformProvider } from "../platform/types.js";

function mockManagedSandbox(id = "sbx-1"): ManagedSandbox {
  return {
    id,
    stop: vi.fn(async () => {}),
    snapshot: vi.fn(async () => "snap-1"),
    extendTimeout: vi.fn(async () => {}),
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () => "hello",
      stderr: async () => "",
    })),
    writeFiles: vi.fn(async () => {}),
    readFile: vi.fn(async () => Buffer.from("content")),
    domain: vi.fn(() => "https://sbx.example.com"),
    updateNetworkPolicy: vi.fn(async () => {}),
  } as unknown as ManagedSandbox;
}

function mockSandboxInfo(overrides?: Partial<SandboxInfo>): SandboxInfo {
  return {
    id: "sbx-1",
    status: "running",
    createdAt: Date.now(),
    memory: 512,
    vcpus: 2,
    ...overrides,
  } as SandboxInfo;
}

function mockProvider(): SandboxProvider {
  return {
    create: vi.fn(),
    get: vi.fn(async (id: string) => mockManagedSandbox(id)),
    list: vi.fn(async () => [mockSandboxInfo()]),
    listSnapshots: vi.fn(async () => [{ id: "snap-1", createdAt: Date.now() }]),
    deleteSnapshot: vi.fn(async () => {}),
  } as unknown as SandboxProvider;
}

function mockPlatform(): PlatformProvider {
  return {
    getConnectArgs: vi.fn(() => ["--project", "myproj", "sbx-1"]),
  } as unknown as PlatformProvider;
}

let provider: SandboxProvider;
let client: ProviderSandboxClient;

beforeEach(() => {
  vi.clearAllMocks();
  provider = mockProvider();
  client = new ProviderSandboxClient(provider, "/deploy", mockPlatform());
});

describe("list", () => {
  it("maps SandboxInfo to SandboxEntry", async () => {
    const entries = await client.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "sbx-1",
      status: "running",
      createdAt: expect.any(Number),
      memory: 512,
      vcpus: 2,
    });
  });
});

describe("stop", () => {
  it("does nothing for empty ids", async () => {
    await client.stop();
    expect(provider.get).not.toHaveBeenCalled();
  });

  it("stops multiple sandboxes in parallel", async () => {
    const sbx1 = mockManagedSandbox("sbx-1");
    const sbx2 = mockManagedSandbox("sbx-2");
    vi.mocked(provider.get).mockResolvedValueOnce(sbx1).mockResolvedValueOnce(sbx2);

    await client.stop("sbx-1", "sbx-2");

    expect(sbx1.stop).toHaveBeenCalled();
    expect(sbx2.stop).toHaveBeenCalled();
  });
});

describe("listSnapshots", () => {
  it("returns snapshot IDs", async () => {
    const ids = await client.listSnapshots();
    expect(ids).toEqual(["snap-1"]);
  });
});

describe("deleteSnapshots", () => {
  it("does nothing for empty ids", async () => {
    await client.deleteSnapshots();
    expect(provider.deleteSnapshot).not.toHaveBeenCalled();
  });

  it("deletes specified snapshots", async () => {
    await client.deleteSnapshots("snap-1", "snap-2");
    expect(provider.deleteSnapshot).toHaveBeenCalledWith("snap-1");
    expect(provider.deleteSnapshot).toHaveBeenCalledWith("snap-2");
  });
});

describe("exec", () => {
  it("runs command and returns result", async () => {
    const result = await client.exec("sbx-1", "echo", ["hi"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
  });

  it("returns error result on exception", async () => {
    const sbx = mockManagedSandbox("sbx-err");
    vi.mocked(sbx.runCommand).mockRejectedValue(new Error("timeout"));
    vi.mocked(provider.get).mockResolvedValue(sbx);

    const result = await client.exec("sbx-err", "slow", []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("timeout");
  });
});

describe("readFile", () => {
  it("returns buffer on success", async () => {
    const buf = await client.readFile("sbx-1", "/etc/hosts");
    expect(buf).toBeInstanceOf(Buffer);
  });

  it("returns null on error", async () => {
    const sbx = mockManagedSandbox("sbx-err");
    vi.mocked(sbx.readFile).mockRejectedValue(new Error("not found"));
    vi.mocked(provider.get).mockResolvedValue(sbx);

    const buf = await client.readFile("sbx-err", "/missing");
    expect(buf).toBeNull();
  });
});

describe("caching", () => {
  it("reuses managed sandbox across calls", async () => {
    await client.exec("sbx-1", "ls", []);
    await client.exec("sbx-1", "pwd", []);

    // provider.get called only once for sbx-1
    expect(provider.get).toHaveBeenCalledTimes(1);
  });
});
