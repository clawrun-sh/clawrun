import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxHandle } from "../../types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: string, encoding?: string) => {
      if (typeof path === "string" && path.endsWith("skill-finder.js")) {
        return "// mock wrapper";
      }
      if (typeof path === "string" && path.endsWith("SKILL.md")) {
        return "# Find Skills\nDiscover and install skills.";
      }
      return actual.readFileSync(path, encoding as BufferEncoding);
    }),
  };
});

function mockSandbox(exitCode = 0): SandboxHandle {
  return {
    runCommand: vi.fn(async () => ({
      exitCode,
      stdout: async () => "",
      stderr: async () => (exitCode === 0 ? "" : "failed"),
    })),
    writeFiles: vi.fn(),
    readFile: vi.fn(),
  } as unknown as SandboxHandle;
}

beforeEach(() => {
  vi.resetModules();
});

describe("FindSkillsTool", () => {
  it("includes npm registry in installDomains", async () => {
    const { FindSkillsTool } = await import("./index.js");
    const tool = new FindSkillsTool();
    expect(tool.installDomains).toContain("registry.npmjs.org");
    expect(tool.installDomains).toContain("github.com");
  });

  it("has skillContent", async () => {
    const { FindSkillsTool } = await import("./index.js");
    const tool = new FindSkillsTool();
    expect(tool.skillContent.length).toBeGreaterThan(0);
  });

  it("installs via npm and drops a wrapper script", async () => {
    const { FindSkillsTool } = await import("./index.js");
    const tool = new FindSkillsTool();
    expect(tool.installCommands.length).toBe(2);
    expect(tool.installCommands[0].args[1]).toContain("npm install -g skills@");
    expect(tool.installCommands[1].args[1]).toContain(".clawrun/bin/skills");
  });

  describe("isInstalled", () => {
    it("returns true when check command succeeds", async () => {
      const { FindSkillsTool } = await import("./index.js");
      const tool = new FindSkillsTool();
      const sandbox = mockSandbox(0);
      expect(await tool.isInstalled(sandbox)).toBe(true);
    });

    it("returns false when check command fails", async () => {
      const { FindSkillsTool } = await import("./index.js");
      const tool = new FindSkillsTool();
      const sandbox = mockSandbox(1);
      expect(await tool.isInstalled(sandbox)).toBe(false);
    });
  });

  describe("install", () => {
    it("runs both install steps", async () => {
      const { FindSkillsTool } = await import("./index.js");
      const tool = new FindSkillsTool();
      const sandbox = mockSandbox(0);
      await tool.install(sandbox);
      expect(sandbox.runCommand).toHaveBeenCalledTimes(2);
    });

    it("throws on non-zero exit code", async () => {
      const { FindSkillsTool } = await import("./index.js");
      const tool = new FindSkillsTool();
      const sandbox = mockSandbox(1);
      await expect(tool.install(sandbox)).rejects.toThrow(/Failed/);
    });
  });
});
