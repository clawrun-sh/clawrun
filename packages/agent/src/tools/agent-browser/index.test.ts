import { describe, it, expect, vi } from "vitest";
import { AgentBrowserTool } from "./index.js";
import type { SandboxHandle } from "../../types.js";

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

  it("includes GitHub release redirect domain in installDomains", () => {
    expect(tool.installDomains).toContain("github.com");
    expect(tool.installDomains).toContain("release-assets.githubusercontent.com");
  });

  it("sets AGENT_BROWSER_NATIVE and MAX_OUTPUT in runtimeEnv", () => {
    expect(tool.runtimeEnv).toEqual({
      AGENT_BROWSER_NATIVE: "1",
      AGENT_BROWSER_MAX_OUTPUT: "50000",
    });
  });

  it("has skillContent loaded from SKILL.md", () => {
    expect(tool.skillContent).toBeDefined();
    expect(tool.skillContent.length).toBeGreaterThan(0);
    expect(tool.skillContent).toContain("agent-browser");
  });

  describe("isInstalled", () => {
    it("returns true when check and version both succeed", async () => {
      const sandbox = mockSandbox();

      expect(await tool.isInstalled(sandbox)).toBe(true);
      expect(sandbox.runCommand).toHaveBeenCalledTimes(2);
    });

    it("returns false when check command fails", async () => {
      const sandbox = mockSandbox({
        [`sh -c test -x "$HOME/.local/opt/agent-browser-v0.16.3/bin/agent-browser"`]: 1,
      });

      expect(await tool.isInstalled(sandbox)).toBe(false);
      // Should not check version if binary doesn't exist
      expect(sandbox.runCommand).toHaveBeenCalledTimes(1);
    });

    it("returns false when version check fails", async () => {
      const sandbox = mockSandbox({ "$HOME/.local/bin/agent-browser --version": 1 });

      expect(await tool.isInstalled(sandbox)).toBe(false);
    });
  });

  describe("install", () => {
    it("runs all install steps sequentially", async () => {
      const sandbox = mockSandbox();

      await tool.install(sandbox);

      // 5 release install steps (raw binary, no extract) + 1 chromium install = 6
      expect(sandbox.runCommand).toHaveBeenCalledTimes(6);
    });

    it("includes chromium install with native mode as final step", async () => {
      const sandbox = mockSandbox();

      await tool.install(sandbox);

      const calls = vi.mocked(sandbox.runCommand).mock.calls;
      const lastCall = calls[calls.length - 1] as unknown as [string, string[]];
      expect(lastCall[0]).toBe("sh");
      expect(lastCall[1][1]).toContain("AGENT_BROWSER_NATIVE=1");
      expect(lastCall[1][1]).toContain("agent-browser install --with-deps");
    });

    it("throws on non-zero exit code", async () => {
      const sandbox = mockSandbox({
        "sh -c AGENT_BROWSER_NATIVE=1 $HOME/.local/bin/agent-browser install --with-deps": 1,
      });

      await expect(tool.install(sandbox)).rejects.toThrow(/Failed/);
    });
  });
});
