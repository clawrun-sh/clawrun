import { describe, it, expect, vi } from "vitest";
import { createSandboxHandle } from "./handle.js";
import type { SandboxClient } from "@clawrun/sdk";
import { sandboxId } from "@clawrun/sdk";

function mockClient(): SandboxClient {
  return {
    list: vi.fn(),
    stop: vi.fn(),
    listSnapshots: vi.fn(),
    deleteSnapshots: vi.fn(),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: "output", stderr: "" })),
    readFile: vi.fn(async () => Buffer.from("data")),
  } as unknown as SandboxClient;
}

describe("createSandboxHandle", () => {
  it("handles string-based runCommand call", async () => {
    const client = mockClient();
    const handle = createSandboxHandle(client, sandboxId("sbx-1"));

    const result = await handle.runCommand("echo", ["hello"]);

    expect(client.exec).toHaveBeenCalledWith("sbx-1", "echo", ["hello"], undefined, {
      timeoutMs: 150_000,
    });
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toBe("output");
    expect(await result.stderr()).toBe("");
  });

  it("handles object-based runCommand call", async () => {
    const client = mockClient();
    const handle = createSandboxHandle(client, sandboxId("sbx-1"));

    await handle.runCommand({ cmd: "ls", args: ["-la"], env: { HOME: "/root" } });

    expect(client.exec).toHaveBeenCalledWith(
      "sbx-1",
      "ls",
      ["-la"],
      { HOME: "/root" },
      { timeoutMs: 150_000 },
    );
  });

  it("uses custom timeout", async () => {
    const client = mockClient();
    const handle = createSandboxHandle(client, sandboxId("sbx-1"), { timeoutMs: 5000 });

    await handle.runCommand("pwd");

    expect(client.exec).toHaveBeenCalledWith("sbx-1", "pwd", [], undefined, { timeoutMs: 5000 });
  });

  it("writeFiles throws not-supported error", async () => {
    const client = mockClient();
    const handle = createSandboxHandle(client, sandboxId("sbx-1"));

    await expect(handle.writeFiles([])).rejects.toThrow(/not supported/);
  });

  it("readFile delegates to client", async () => {
    const client = mockClient();
    const handle = createSandboxHandle(client, sandboxId("sbx-1"));

    const buf = await handle.readFile("/etc/hosts");

    expect(client.readFile).toHaveBeenCalledWith("sbx-1", "/etc/hosts");
    expect(buf).toBeInstanceOf(Buffer);
  });
});
