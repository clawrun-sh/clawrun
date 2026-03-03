import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Mocks ---

const mockSandboxCreate = vi.fn();
const mockSandboxList = vi.fn();
const mockSandboxGet = vi.fn();
const mockSnapshotList = vi.fn();
const mockSnapshotGet = vi.fn();
const mockGetAuth = vi.fn();
const mockUpdateNetworkPolicy = vi.fn();

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

function createTempProjectDir(): string {
  const dir = join(tempDir, `project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const vercelDir = join(dir, ".vercel");
  mkdirSync(vercelDir, { recursive: true });
  writeFileSync(
    join(vercelDir, "project.json"),
    JSON.stringify({ projectId: "prj_abc", orgId: "team_xyz" }),
  );
  return dir;
}

function createProviderWithCreds(): VercelSandboxProvider {
  const dir = createTempProjectDir();
  mockGetAuth.mockReturnValue({ token: "tok_123" });
  return new VercelSandboxProvider({ projectDir: dir });
}

// --- Tests ---

beforeEach(() => {
  tempDir = join(tmpdir(), `vercel-net-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("updateNetworkPolicy delegation", () => {
  it("delegates updateNetworkPolicy to underlying Vercel SDK sandbox", async () => {
    const provider = createProviderWithCreds();

    // create() returns a sandbox with updateNetworkPolicy
    mockSandboxCreate.mockResolvedValue({
      sandboxId: "sbx_1",
      status: "running",
      createdAt: new Date(),
      timeout: 300000,
      updateNetworkPolicy: mockUpdateNetworkPolicy.mockResolvedValue(undefined),
      domain: () => "https://sbx_1.example.com",
    });

    const sandbox = await provider.create({ timeout: 300000 });

    const policy = { allow: ["api.openai.com", "openrouter.ai"] };
    await sandbox.updateNetworkPolicy(policy);

    expect(mockUpdateNetworkPolicy).toHaveBeenCalledOnce();
    expect(mockUpdateNetworkPolicy).toHaveBeenCalledWith(policy);
  });

  it("passes deny-all policy to SDK", async () => {
    const provider = createProviderWithCreds();

    mockSandboxCreate.mockResolvedValue({
      sandboxId: "sbx_2",
      status: "running",
      createdAt: new Date(),
      timeout: 300000,
      updateNetworkPolicy: mockUpdateNetworkPolicy.mockResolvedValue(undefined),
    });

    const sandbox = await provider.create({ timeout: 300000 });
    await sandbox.updateNetworkPolicy("deny-all");

    expect(mockUpdateNetworkPolicy).toHaveBeenCalledWith("deny-all");
  });

  it("passes complex policy with subnets to SDK", async () => {
    const provider = createProviderWithCreds();

    mockSandboxCreate.mockResolvedValue({
      sandboxId: "sbx_3",
      status: "running",
      createdAt: new Date(),
      timeout: 300000,
      updateNetworkPolicy: mockUpdateNetworkPolicy.mockResolvedValue(undefined),
    });

    const sandbox = await provider.create({ timeout: 300000 });
    const policy = {
      allow: ["api.openai.com"],
      subnets: { deny: ["10.0.0.0/8"] },
    };
    await sandbox.updateNetworkPolicy(policy);

    expect(mockUpdateNetworkPolicy).toHaveBeenCalledWith(policy);
  });
});

describe("create() with networkPolicy option", () => {
  it("passes networkPolicy to Sandbox.create when provided", async () => {
    const provider = createProviderWithCreds();

    mockSandboxCreate.mockResolvedValue({
      sandboxId: "sbx_4",
      status: "running",
      createdAt: new Date(),
      timeout: 300000,
    });

    await provider.create({
      timeout: 300000,
      networkPolicy: { allow: ["api.anthropic.com"] },
    });

    expect(mockSandboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        networkPolicy: { allow: ["api.anthropic.com"] },
      }),
    );
  });

  it("does not include networkPolicy key when not provided", async () => {
    const provider = createProviderWithCreds();

    mockSandboxCreate.mockResolvedValue({
      sandboxId: "sbx_5",
      status: "running",
      createdAt: new Date(),
      timeout: 300000,
    });

    await provider.create({ timeout: 300000 });

    const createArg = mockSandboxCreate.mock.calls[0][0];
    expect(createArg).not.toHaveProperty("networkPolicy");
  });
});
