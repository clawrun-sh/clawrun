import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxClient } from "./sandbox.js";
import { sandboxId, snapshotId } from "@clawrun/provider";
import type { SandboxProvider, ManagedSandbox } from "@clawrun/provider";

function createMockSandbox(overrides?: Partial<ManagedSandbox>): ManagedSandbox {
  return {
    id: sandboxId("sbx-1"),
    status: "running",
    createdAt: Date.now(),
    memory: 512,
    vcpus: 1,
    stop: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: async () => "output",
      stderr: async () => "",
    }),
    readFile: vi.fn().mockResolvedValue(Buffer.from("file content")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    uploadFiles: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from("")),
    snapshot: vi.fn().mockResolvedValue("snap-1"),
    extend: vi.fn().mockResolvedValue(undefined),
    updateNetworkPolicy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ManagedSandbox;
}

function createMockProvider(
  sandboxes: ManagedSandbox[] = [],
  snapshots: Array<{ id: string }> = [],
): SandboxProvider {
  return {
    create: vi.fn(),
    get: vi.fn().mockImplementation(async (id: string) => {
      const found = sandboxes.find((s) => s.id === id);
      if (!found) throw new Error(`Sandbox ${id} not found`);
      return found;
    }),
    list: vi.fn().mockResolvedValue(sandboxes),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
    deleteSnapshot: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxProvider;
}

describe("SandboxClient", () => {
  let sandbox1: ManagedSandbox;
  let sandbox2: ManagedSandbox;
  let provider: SandboxProvider;
  let client: SandboxClient;

  beforeEach(() => {
    sandbox1 = createMockSandbox({ id: sandboxId("sbx-1"), status: "running" });
    sandbox2 = createMockSandbox({ id: sandboxId("sbx-2"), status: "stopped" });
    provider = createMockProvider([sandbox1, sandbox2], [{ id: "snap-1" }, { id: "snap-2" }]);
    client = new SandboxClient(provider);
  });

  describe("list", () => {
    it("returns simplified sandbox entries", async () => {
      const result = await client.list();
      expect(result).toEqual([
        expect.objectContaining({ id: "sbx-1", status: "running" }),
        expect.objectContaining({ id: "sbx-2", status: "stopped" }),
      ]);
      expect(provider.list).toHaveBeenCalled();
    });

    it("maps all fields", async () => {
      const result = await client.list();
      for (const entry of result) {
        expect(entry).toHaveProperty("id");
        expect(entry).toHaveProperty("status");
        expect(entry).toHaveProperty("createdAt");
        expect(entry).toHaveProperty("memory");
        expect(entry).toHaveProperty("vcpus");
      }
    });
  });

  describe("stop", () => {
    it("stops specified sandboxes", async () => {
      await client.stop(sandboxId("sbx-1"));
      expect(provider.get).toHaveBeenCalledWith("sbx-1");
      expect(sandbox1.stop).toHaveBeenCalled();
    });

    it("stops multiple sandboxes in parallel", async () => {
      await client.stop(sandboxId("sbx-1"), sandboxId("sbx-2"));
      expect(sandbox1.stop).toHaveBeenCalled();
      expect(sandbox2.stop).toHaveBeenCalled();
    });

    it("does nothing with no IDs", async () => {
      await client.stop();
      expect(provider.get).not.toHaveBeenCalled();
    });
  });

  describe("listSnapshots", () => {
    it("returns snapshot IDs", async () => {
      const result = await client.listSnapshots();
      expect(result).toEqual(["snap-1", "snap-2"]);
    });
  });

  describe("deleteSnapshots", () => {
    it("deletes specified snapshots", async () => {
      await client.deleteSnapshots(snapshotId("snap-1"), snapshotId("snap-2"));
      expect(provider.deleteSnapshot).toHaveBeenCalledWith("snap-1");
      expect(provider.deleteSnapshot).toHaveBeenCalledWith("snap-2");
    });

    it("does nothing with no IDs", async () => {
      await client.deleteSnapshots();
      expect(provider.deleteSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("exec", () => {
    it("executes a command and returns result", async () => {
      const result = await client.exec(sandboxId("sbx-1"), "ls", ["-la"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("output");
      expect(result.stderr).toBe("");
      expect(sandbox1.runCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: "ls",
          args: ["-la"],
        }),
      );
    });

    it("passes env and timeout", async () => {
      await client.exec(sandboxId("sbx-1"), "echo", ["hi"], { FOO: "bar" }, { timeoutMs: 5000 });
      expect(sandbox1.runCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: "echo",
          args: ["hi"],
          env: { FOO: "bar" },
        }),
      );
    });

    it("propagates infrastructure errors", async () => {
      sandbox1.runCommand = vi.fn().mockRejectedValue(new Error("sandbox not reachable"));
      await expect(client.exec(sandboxId("sbx-1"), "slow-cmd", [])).rejects.toThrow(
        "sandbox not reachable",
      );
    });
  });

  describe("readFile", () => {
    it("reads a file from the sandbox", async () => {
      const result = await client.readFile(sandboxId("sbx-1"), "/root/test.txt");
      expect(result).toEqual(Buffer.from("file content"));
      expect(sandbox1.readFile).toHaveBeenCalledWith("/root/test.txt");
    });

    it("returns null on error", async () => {
      sandbox1.readFile = vi.fn().mockRejectedValue(new Error("not found"));
      const result = await client.readFile(sandboxId("sbx-1"), "/nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("caching", () => {
    it("caches sandbox instances", async () => {
      await client.exec(sandboxId("sbx-1"), "ls", []);
      await client.exec(sandboxId("sbx-1"), "pwd", []);
      // provider.get should only be called once for the same ID
      expect(provider.get).toHaveBeenCalledTimes(1);
    });

    it("does not cache different sandbox IDs", async () => {
      await client.exec(sandboxId("sbx-1"), "ls", []);
      await client.exec(sandboxId("sbx-2"), "ls", []);
      expect(provider.get).toHaveBeenCalledTimes(2);
    });
  });
});
