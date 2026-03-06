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
const mockGetAuth = vi.fn();

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

vi.mock("@vercel/sandbox/dist/auth/file.js", () => ({
  getAuth: () => mockGetAuth(),
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
  it("resolves credentials when project.json and auth token are available", () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockGetAuth.mockReturnValue({ token: "tok_123" });

    const provider = new VercelSandboxProvider({ projectDir: dir });

    // Verify credentials are set by making a list() call
    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });
    provider.list();

    expect(mockSandboxList).toHaveBeenCalledWith({
      token: "tok_123",
      projectId: "prj_abc",
      teamId: "team_xyz",
    });
  });

  it("returns undefined credentials when project.json is missing", () => {
    const dir = join(tempDir, "no-vercel-dir");
    mkdirSync(dir, { recursive: true });
    // No .vercel/project.json created
    mockGetAuth.mockReturnValue({ token: "tok_123" });

    const provider = new VercelSandboxProvider({ projectDir: dir });

    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });
    provider.list();

    // Should call with undefined (no credentials) — triggers withScope fallback
    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined credentials when projectId is missing from project.json", () => {
    const dir = createTempProjectDir({ orgId: "team_xyz" });
    mockGetAuth.mockReturnValue({ token: "tok_123" });

    const provider = new VercelSandboxProvider({ projectDir: dir });

    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });
    provider.list();

    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined credentials when orgId is missing from project.json", () => {
    const dir = createTempProjectDir({ projectId: "prj_abc" });
    mockGetAuth.mockReturnValue({ token: "tok_123" });

    const provider = new VercelSandboxProvider({ projectDir: dir });

    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });
    provider.list();

    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined credentials when getAuth returns null", () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockGetAuth.mockReturnValue(null);

    const provider = new VercelSandboxProvider({ projectDir: dir });

    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });
    provider.list();

    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined credentials when getAuth returns object without token", () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockGetAuth.mockReturnValue({ refreshToken: "ref_456" });

    const provider = new VercelSandboxProvider({ projectDir: dir });

    mockSandboxList.mockResolvedValue({ json: { sandboxes: [] } });
    provider.list();

    expect(mockSandboxList).toHaveBeenCalledWith(undefined);
  });
});

describe("SDK call scoping — credentials vs withScope", () => {
  it("passes credentials directly to Sandbox.list when resolved", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockGetAuth.mockReturnValue({ token: "tok_123" });
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
    mockGetAuth.mockReturnValue({ token: "tok_123" });
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
    mockGetAuth.mockReturnValue({ token: "tok_123" });
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

  it("falls back to withScope (chdir) when credentials not resolved", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockGetAuth.mockReturnValue(null); // no token → no credentials
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
    mockGetAuth.mockReturnValue({ token: "tok_shared" });

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

    // Call concurrently — the original bug
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
    mockGetAuth.mockReturnValue({ token: "tok_123" });

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
    mockGetAuth.mockReturnValue({ token: "tok_123" });

    const err = new Error("not found") as Error & { text?: string };
    err.text = "snapshot has expired or deleted";
    mockSnapshotGet.mockRejectedValue(err);

    const provider = new VercelSandboxProvider({ projectDir: dir });
    // Should not throw
    await expect(provider.deleteSnapshot(snapshotId("snap_old"))).resolves.toBeUndefined();
  });

  it("rethrows non-expiry errors", async () => {
    const dir = createTempProjectDir({ projectId: "prj_abc", orgId: "team_xyz" });
    mockGetAuth.mockReturnValue({ token: "tok_123" });

    mockSnapshotGet.mockRejectedValue(new Error("network error"));

    const provider = new VercelSandboxProvider({ projectDir: dir });
    await expect(provider.deleteSnapshot(snapshotId("snap_1"))).rejects.toThrow("network error");
  });
});
