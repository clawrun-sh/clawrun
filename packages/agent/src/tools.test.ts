import { describe, it, expect, vi } from "vitest";
import { runTools, type Tool } from "./tools.js";
import type { SandboxHandle } from "./types.js";

function mockSandbox(): SandboxHandle {
  return {
    runCommand: vi.fn(),
    writeFiles: vi.fn(),
    readFile: vi.fn(),
    domain: vi.fn(() => "https://sbx.example.com"),
  } as unknown as SandboxHandle;
}

function makeTool(overrides?: Partial<Tool>): Tool {
  return {
    id: "test-tool",
    name: "Test Tool",
    description: "A test tool",
    installDomains: ["example.com"],
    checkCommand: { cmd: "which", args: ["test-tool"] },
    installCommands: [{ cmd: "apt-get", args: ["install", "test-tool"] }],
    isInstalled: vi.fn(async () => false),
    install: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runTools", () => {
  it("returns empty array for no tools", async () => {
    const results = await runTools(mockSandbox(), []);
    expect(results).toEqual([]);
  });

  it("skips already-installed tools", async () => {
    const tool = makeTool({ isInstalled: vi.fn(async () => true) });
    const sandbox = mockSandbox();

    const results = await runTools(sandbox, [tool]);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("skipped");
    expect(results[0].toolId).toBe("test-tool");
    expect(tool.install).not.toHaveBeenCalled();
  });

  it("installs tools that are not present", async () => {
    const tool = makeTool();
    const sandbox = mockSandbox();

    const results = await runTools(sandbox, [tool]);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("installed");
    expect(tool.install).toHaveBeenCalledWith(sandbox);
  });

  it("records duration for each tool", async () => {
    const tool = makeTool();
    const results = await runTools(mockSandbox(), [tool]);

    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails fast on install error", async () => {
    const tool1 = makeTool({
      id: "tool-1",
      install: vi.fn(async () => {
        throw new Error("install crashed");
      }),
    });
    const tool2 = makeTool({ id: "tool-2" });

    const results = await runTools(mockSandbox(), [tool1, tool2]);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("failed");
    expect(results[0].error).toBe("install crashed");
    // tool2 never ran
    expect(tool2.isInstalled).not.toHaveBeenCalled();
  });

  it("handles non-Error throws", async () => {
    const tool = makeTool({
      install: vi.fn(async () => {
        throw "string error";
      }),
    });

    const results = await runTools(mockSandbox(), [tool]);

    expect(results[0].action).toBe("failed");
    expect(results[0].error).toBe("string error");
  });

  it("processes multiple tools sequentially", async () => {
    const order: string[] = [];
    const tool1 = makeTool({
      id: "tool-a",
      isInstalled: vi.fn(async () => {
        order.push("check-a");
        return true;
      }),
    });
    const tool2 = makeTool({
      id: "tool-b",
      isInstalled: vi.fn(async () => {
        order.push("check-b");
        return false;
      }),
      install: vi.fn(async () => {
        order.push("install-b");
      }),
    });

    const results = await runTools(mockSandbox(), [tool1, tool2]);

    expect(results).toHaveLength(2);
    expect(results[0].action).toBe("skipped");
    expect(results[1].action).toBe("installed");
    expect(order).toEqual(["check-a", "check-b", "install-b"]);
  });
});
