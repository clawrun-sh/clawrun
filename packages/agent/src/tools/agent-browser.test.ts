import { describe, it, expect, vi } from "vitest";
import { AgentBrowserTool } from "./agent-browser.js";
import type { SandboxHandle } from "../types.js";

function mockSandbox(exitCodes: Record<string, number> = {}): SandboxHandle {
  return {
    runCommand: vi.fn(async (cmd: string, args?: string[]) => {
      const key = args ? `${cmd} ${args.join(" ")}` : cmd;
      const exitCode = exitCodes[key] ?? 0;
      return {
        exitCode,
        stdout: async () => (exitCode === 0 ? "/usr/bin/agent-browser" : ""),
        stderr: async () => (exitCode === 0 ? "" : `${key} failed`),
      };
    }),
    writeFiles: vi.fn(),
    readFile: vi.fn(),
  } as unknown as SandboxHandle;
}

describe("AgentBrowserTool", () => {
  const tool = new AgentBrowserTool();

  it("has correct id and metadata", () => {
    expect(tool.id).toBe("agent-browser");
    expect(tool.name).toBe("Agent Browser");
    expect(tool.installDomains.length).toBeGreaterThan(0);
  });

  describe("isInstalled", () => {
    it("returns true when which and version both succeed", async () => {
      const sandbox = mockSandbox();

      expect(await tool.isInstalled(sandbox)).toBe(true);
      expect(sandbox.runCommand).toHaveBeenCalledTimes(2);
    });

    it("returns false when which fails", async () => {
      const sandbox = mockSandbox({ "which agent-browser": 1 });

      expect(await tool.isInstalled(sandbox)).toBe(false);
      // Should not check version if which fails
      expect(sandbox.runCommand).toHaveBeenCalledTimes(1);
    });

    it("returns false when version check fails", async () => {
      const sandbox = mockSandbox({ "agent-browser --version": 1 });

      expect(await tool.isInstalled(sandbox)).toBe(false);
    });
  });

  describe("install", () => {
    it("runs all install steps sequentially", async () => {
      const sandbox = mockSandbox();

      await tool.install(sandbox);

      expect(sandbox.runCommand).toHaveBeenCalledTimes(2);
    });

    it("throws on non-zero exit code", async () => {
      const sandbox = mockSandbox({
        "sh -c agent-browser install --with-deps": 1,
      });

      await expect(tool.install(sandbox)).rejects.toThrow(/Failed/);
    });
  });
});
