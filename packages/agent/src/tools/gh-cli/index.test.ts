import { describe, it, expect, vi } from "vitest";
import { GhCliTool } from "./index.js";
import type { SandboxHandle } from "../../types.js";

function mockSandbox(exitCodes: Record<string, number> = {}): SandboxHandle {
  return {
    runCommand: vi.fn(async (cmd: string, args?: string[]) => {
      const key = args ? `${cmd} ${args.join(" ")}` : cmd;
      const exitCode = exitCodes[key] ?? 0;
      return {
        exitCode,
        stdout: async () => "",
        stderr: async () => (exitCode === 0 ? "" : `${key} failed`),
      };
    }),
    writeFiles: vi.fn(),
    readFile: vi.fn(),
  } as unknown as SandboxHandle;
}

describe("GhCliTool", () => {
  const tool = new GhCliTool();

  it("includes GitHub release redirect domain in installDomains", () => {
    expect(tool.installDomains).toContain("github.com");
    expect(tool.installDomains).toContain("release-assets.githubusercontent.com");
  });

  it("has skillContent loaded from SKILL.md", () => {
    expect(tool.skillContent).toBeDefined();
    expect(tool.skillContent!.length).toBeGreaterThan(0);
  });

  describe("isInstalled", () => {
    it("returns true when check command succeeds", async () => {
      const sandbox = mockSandbox();
      expect(await tool.isInstalled(sandbox)).toBe(true);
    });

    it("returns false when check command fails", async () => {
      const sandbox = {
        ...mockSandbox(),
        runCommand: vi.fn(async () => ({
          exitCode: 1,
          stdout: async () => "",
          stderr: async () => "not found",
        })),
      } as unknown as SandboxHandle;
      expect(await tool.isInstalled(sandbox)).toBe(false);
    });
  });

  describe("install", () => {
    it("runs all install steps sequentially", async () => {
      const sandbox = mockSandbox();
      await tool.install(sandbox);
      expect(sandbox.runCommand).toHaveBeenCalled();
    });

    it("throws on non-zero exit code", async () => {
      const sandbox = {
        ...mockSandbox(),
        runCommand: vi.fn(async () => ({
          exitCode: 1,
          stdout: async () => "",
          stderr: async () => "download failed",
        })),
      } as unknown as SandboxHandle;
      await expect(tool.install(sandbox)).rejects.toThrow(/Failed/);
    });
  });
});
