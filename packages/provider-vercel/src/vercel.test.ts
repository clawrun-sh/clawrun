import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sandboxId, snapshotId } from "@clawrun/provider";

// --- Mocks ---

const mockSandboxList = vi.fn();
const mockSandboxCreate = vi.fn();
const mockSandboxGet = vi.fn();
const mockSnapshotList = vi.fn();
const mockSnapshotGet = vi.fn();
const mockCachedGenerateCredentials = vi.fn();
const mockGenerateCredentials = vi.fn();

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    list: (...args: unknown[]) => mockSandboxList(...args),
    create: (...args: unknown[]) => mockSandboxCreate(...args),
    get: (...args: unknown[]) => mockSandboxGet(...args),
  },
  Snapshot: {
    list: (...args: unknown[]) => mockSnapshotList(...args),
    get: (...args: unknown[]) => mockSnapshotGet(...args),
  },
}));

vi.mock("@vercel/sandbox/dist/utils/dev-credentials.js", () => ({
  cachedGenerateCredentials: (...args: unknown[]) => mockCachedGenerateCredentials(...args),
  generateCredentials: (...args: unknown[]) => mockGenerateCredentials(...args),
}));

import { VercelSandboxProvider } from "./vercel.js";

// --- Helpers ---

let tempDir: string;

function createTempProjectDir(opts?: { projectId?: string; orgId?: string }): string {
  const dir = join(tempDir, `project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const vercelDir = join(dir, ".vercel");
  mkdirSync(vercelDir, { recursive: true });
  if (opts) {
    writeFileSync(join(vercelDir, "project.json"), JSON.stringify(opts));
  }
  return dir;
}

// --- Tests ---

beforeEach(() => {
  tempDir = join(tmpdir(), `vercel-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("credential resolution", () => {
  it("resolves credentials when project.json is available", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.list();

    expect(mockCachedGenerateCredentials).toHaveBeenCalledWith({
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    expect(mockSandboxList).toHaveBeenCalledWith({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
  });

  it("returns undefined credentials when project.json is missing", async () => {
    const dir = join(tempDir, "no-vercel-dir");
    mkdirSync(dir, { recursive: true });
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.list();

    expect(mockCachedGenerateCredentials).not.toHaveBeenCalled();
    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined credentials when projectId is missing from project.json", async () => {
    const dir = createTempProjectDir({ orgId: "team_xyz" });
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.list();

    expect(mockCachedGenerateCredentials).not.toHaveBeenCalled();
    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined credentials when orgId is missing from project.json", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc" });
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.list();

    expect(mockCachedGenerateCredentials).not.toHaveBeenCalled();
    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });
});

describe("SDK call scoping — credentials vs withScope", () => {
  it("passes credentials directly to Sandbox.list when resolved", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.list();

    expect(mockSandboxList).toHaveBeenCalledWith({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
  });

  it("passes credentials directly to Sandbox.get when resolved", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    mockSandboxGet.mockResolvedValue({
      sandboxId: "sbx_1",
      status: "running",
      createdAt: new Date(),
      timeout: 60000,
    });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.get(sandboxId("sbx_1"));

    expect(mockSandboxGet).toHaveBeenCalledWith({
      sandboxId: "sbx_1",
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
  });

  it("passes credentials to Sandbox.create when resolved", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    mockSandboxCreate.mockResolvedValue({
      sandboxId: "sbx_new",
      status: "running",
      createdAt: new Date(),
      timeout: 300000,
    });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.create({ timeout: 300000 });

    expect(mockSandboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "tok_123",
        projectId: "prj_abc",
        teamId: "team_xyz",
        timeout: 300000,
      }),
    );
  });

  it("falls back to withScope (chdir) when scope not resolved", async () => {
    const dir = join(tempDir, "no-vercel-dir");
    mkdirSync(dir, { recursive: true });
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });

    const origCwd = process.cwd();
    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.list();

    // withScope should have temporarily changed cwd to projectDir
    // and restored it after. Verify cwd is restored.
    expect(process.cwd()).toBe(origCwd);

    // SDK was called with undefined (auto-resolve mode)
    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });

  it("calls SDK directly when no projectDir provided", async () => {
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });

    const provider = new VercelSandboxProvider();
    await provider.list();

    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });
});

describe("concurrent list calls — different projects get different credentials", () => {
  it("two providers with different project dirs pass different credentials", async () => {
    const dirA = createTempProjectDir({ projectId: "prj_A", orgId: "team_A" });
    const dirB = createTempProjectDir({ projectId: "prj_B", orgId: "team_B" });

    mockCachedGenerateCredentials.mockImplementation(
      async (opts: { teamId: string; projectId: string }) => ({
        token: "tok_shared",
        projectId: opts.projectId,
        teamId: opts.teamId,
      }),
    );

    mockSandboxList.mockResolvedValue({
      json: {
        sandboxes: [
          {
            id: "sbx_1",
            status: "running",
            createdAt: 1000,
            timeout: 60000,
            memory: 512,
            vcpus: 1,
          },
        ],
      },
    });

    const providerA = new VercelSandboxProvider({ projectDir: dirA });
    const providerB = new VercelSandboxProvider({ projectDir: dirB });

    // Call concurrently
    await Promise.all([providerA.list(), providerB.list()]);

    expect(mockSandboxList).toHaveBeenCalledTimes(2);
    expect(mockSandboxList).toHaveBeenCalledWith({
      token: "tok_shared",
      projectId: "prj_A",
      teamId: "team_A",
    });
    expect(mockSandboxList).toHaveBeenCalledWith({
      token: "tok_shared",
      projectId: "prj_B",
      teamId: "team_B",
    });
  });
});

describe("deleteSnapshot", () => {
  it("deletes a snapshot normally", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });

    const mockDelete = vi.fn().mockResolvedValue(undefined);
    mockSnapshotGet.mockResolvedValue({ delete: mockDelete });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.deleteSnapshot(snapshotId("snap_1"));

    expect(mockSnapshotGet).toHaveBeenCalledWith({
      snapshotId: "snap_1",
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    expect(mockDelete).toHaveBeenCalled();
  });

  it("treats 'expired or deleted' as success", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });

    const err = new Error("not found") as Error & { text?: string };
    err.text = "snapshot has expired or deleted";
    mockSnapshotGet.mockRejectedValue(err);

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await expect(provider.deleteSnapshot(snapshotId("snap_old"))).resolves.toBeUndefined();
  });

  it("rethrows non-expiry errors", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });

    mockSnapshotGet.mockRejectedValue(new Error("network error"));

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await expect(provider.deleteSnapshot(snapshotId("snap_1"))).rejects.toThrow("network error");
  });
});

describe("401 retry with token refresh", () => {
  it("retries with fresh credentials on 401", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_stale",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    mockGenerateCredentials.mockResolvedValue({
      token: "tok_fresh",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });

    const err401 = new Error("API request failed with status 401") as Error & { status?: number };
    err401.status = 401;

    // First call rejects with 401, second succeeds
    mockSandboxList
      .mockRejectedValueOnce(err401)
      .mockResolvedValueOnce({ json: { sandboxes: [] } });

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await provider.list();

    expect(mockSandboxList).toHaveBeenCalledTimes(2);
    // First call used stale token
    expect(mockSandboxList).toHaveBeenNthCalledWith(1, {
      token: "tok_stale",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    // Retry used fresh token from generateCredentials
    expect(mockSandboxList).toHaveBeenNthCalledWith(2, {
      token: "tok_fresh",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
    expect(mockGenerateCredentials).toHaveBeenCalledWith({
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
  });

  it("does not retry non-401 errors", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockCachedGenerateCredentials.mockResolvedValue({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });

    mockSandboxList.mockRejectedValue(new Error("network error"));

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await expect(provider.list()).rejects.toThrow("network error");

    expect(mockSandboxList).toHaveBeenCalledTimes(1);
    expect(mockGenerateCredentials).not.toHaveBeenCalled();
  });
});
