import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ZeroclawSandbox, CommandResult } from "./types.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => Buffer.from("binary-content")),
  readdirSync: vi.fn((dir: string) => {
    if (dir.endsWith("/skills")) return ["agent-browser", "skills-cli"];
    if (dir.endsWith("/agent-browser") || dir.endsWith("/skills-cli")) return ["SKILL.md"];
    return ["IDENTITY.md", "BOOTSTRAP.md", "notes.txt"];
  }),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}));

vi.mock("./binary.js", () => ({
  getBinaryPath: vi.fn(() => "/local/zeroclaw-linux-x64"),
}));

vi.mock("./config-generator.js", () => ({
  generateDaemonToml: vi.fn(() => "[daemon]\nport = 3000\n"),
}));

vi.mock("./config-reader.js", () => ({
  readParsedConfig: vi.fn(() => ({ default_provider: "openrouter" })),
}));

import { readdirSync, statSync } from "node:fs";

interface SandboxFile {
  path: string;
  content: Buffer;
}

type RunCommandArgs = [cmd: string, args?: string[]];

function mockSandbox() {
  return {
    runCommand: vi.fn(async (cmd: string, args?: string[]): Promise<CommandResult> => {
      // Handle "sh -c 'test -x ... && echo ok'" → must return "ok"
      if (cmd === "sh" && args?.[1]?.includes("test -x")) {
        return { exitCode: 0, stdout: async () => "ok\n", stderr: async () => "" };
      }
      // Handle "sh -c 'echo ~'" and "sh -c 'echo $HOME'"
      if (cmd === "sh" && args?.[1]?.includes("echo")) {
        return { exitCode: 0, stdout: async () => "/home/user\n", stderr: async () => "" };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    }),
    writeFiles: vi.fn(async (_files: SandboxFile[]) => {}),
    readFile: vi.fn(async (_path: string): Promise<Buffer | null> => null),
  };
}

function defaultOpts() {
  return {
    binPath: "/home/user/.clawrun/bin/zeroclaw",
    agentDir: "/home/user/.clawrun/agent",
    localAgentDir: "/local/agent",
    secretKey: "my-secret-key",
    fromSnapshot: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provision", () => {
  let provision: typeof import("./provision.js").provision;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./provision.js");
    provision = mod.provision;
  });

  it("creates directories, writes binary, and makes it executable", async () => {
    const sandbox = mockSandbox();
    await provision(sandbox as unknown as ZeroclawSandbox, defaultOpts());

    // mkdir -p for agentDir and binDir
    const mkdirCall = (sandbox.runCommand.mock.calls as RunCommandArgs[]).find(
      (c) => c[0] === "mkdir",
    );
    expect(mkdirCall).toBeDefined();
    expect(mkdirCall![1]).toContain("/home/user/.clawrun/agent");
    expect(mkdirCall![1]).toContain("/home/user/.clawrun/bin");

    // chmod +x on binary
    const chmodCall = (sandbox.runCommand.mock.calls as RunCommandArgs[]).find(
      (c) => c[0] === "chmod" && c[1]?.[0] === "+x",
    );
    expect(chmodCall).toBeDefined();
  });

  it("verifies binary is executable after chmod", async () => {
    const sandbox = mockSandbox();
    // test -x returns "ok"
    sandbox.runCommand.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "sh" && args?.[1]?.includes("test -x")) {
        return { exitCode: 0, stdout: async () => "ok\n", stderr: async () => "" };
      }
      if (cmd === "sh" && args?.[1]?.includes("echo")) {
        return { exitCode: 0, stdout: async () => "/home/user\n", stderr: async () => "" };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    });

    await provision(sandbox as unknown as ZeroclawSandbox, defaultOpts());

    // Explicitly verify the test -x command was issued
    const testCall = (sandbox.runCommand.mock.calls as RunCommandArgs[]).find(
      (c) => c[0] === "sh" && c[1]?.[1]?.includes("test -x"),
    );
    expect(testCall).toBeDefined();
  });

  it("throws when binary is not executable", async () => {
    const sandbox = mockSandbox();
    sandbox.runCommand.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "sh" && args?.[1]?.includes("test -x")) {
        return { exitCode: 1, stdout: async () => "", stderr: async () => "" };
      }
      return { exitCode: 0, stdout: async () => "/home/user\n", stderr: async () => "" };
    });

    await expect(provision(sandbox as unknown as ZeroclawSandbox, defaultOpts())).rejects.toThrow(
      "Binary not executable",
    );
  });

  it("throws when chmod fails", async () => {
    const sandbox = mockSandbox();
    sandbox.runCommand.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "chmod" && args?.[0] === "+x") {
        return { exitCode: 1, stdout: async () => "", stderr: async () => "permission denied" };
      }
      return { exitCode: 0, stdout: async () => "/home/user\n", stderr: async () => "" };
    });

    await expect(provision(sandbox as unknown as ZeroclawSandbox, defaultOpts())).rejects.toThrow(
      "chmod failed",
    );
  });

  it("writes config.toml and .secret_key", async () => {
    const sandbox = mockSandbox();
    await provision(sandbox as unknown as ZeroclawSandbox, defaultOpts());

    // Find the writeFiles call that includes config.toml
    const writeCall = sandbox.writeFiles.mock.calls.find((c) =>
      c[0].some((f) => f.path.includes("config.toml")),
    );
    expect(writeCall).toBeDefined();

    const files = writeCall![0];
    const configFile = files.find((f) => f.path.includes("config.toml"));
    const secretFile = files.find((f) => f.path.includes(".secret_key"));

    expect(configFile).toBeDefined();
    expect(configFile!.content.toString()).toContain("[daemon]");
    expect(secretFile).toBeDefined();
    expect(secretFile!.content.toString()).toBe("my-secret-key");
  });

  it("writes workspace .md files and skills on fresh sandbox", async () => {
    const sandbox = mockSandbox();
    const opts = { ...defaultOpts(), fromSnapshot: false };
    await provision(sandbox as unknown as ZeroclawSandbox, opts);

    const allWrittenFiles = sandbox.writeFiles.mock.calls.flatMap((c) => c[0]);
    const workspaceMdFiles = allWrittenFiles.filter(
      (f) => f.path.includes("workspace/") && !f.path.includes("skills/"),
    );
    // readdirSync returns ["IDENTITY.md", "BOOTSTRAP.md", "notes.txt"]
    // Only .md files should be included
    expect(workspaceMdFiles.length).toBe(2);
    expect(workspaceMdFiles.some((f) => f.path.endsWith("IDENTITY.md"))).toBe(true);
    expect(workspaceMdFiles.some((f) => f.path.endsWith("BOOTSTRAP.md"))).toBe(true);

    // Skills should also be written
    const skillFiles = allWrittenFiles.filter((f) => f.path.includes("workspace/skills/"));
    expect(skillFiles.some((f) => f.path.includes("agent-browser/SKILL.md"))).toBe(true);
    expect(skillFiles.some((f) => f.path.includes("skills-cli/SKILL.md"))).toBe(true);
  });

  it("skips workspace .md files on snapshot restore but still writes skills", async () => {
    const sandbox = mockSandbox();
    const opts = { ...defaultOpts(), fromSnapshot: true };
    await provision(sandbox as unknown as ZeroclawSandbox, opts);

    const allWrittenFiles = sandbox.writeFiles.mock.calls.flatMap((c) => c[0]);
    const workspaceMdFiles = allWrittenFiles.filter(
      (f) => f.path.includes("workspace/") && !f.path.includes("skills/"),
    );
    expect(workspaceMdFiles.length).toBe(0);

    // Skills should still be written even on snapshot restore
    const skillFiles = allWrittenFiles.filter((f) => f.path.includes("workspace/skills/"));
    expect(skillFiles.length).toBeGreaterThan(0);
    expect(skillFiles.some((f) => f.path.includes("skills-cli/SKILL.md"))).toBe(true);
  });

  it("handles missing workspace directory gracefully", async () => {
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const sandbox = mockSandbox();
    const opts = { ...defaultOpts(), fromSnapshot: false };
    await provision(sandbox as unknown as ZeroclawSandbox, opts);
    // Should not throw — workspace dir is optional
  });

  it("writes .profile with correct env vars to $HOME", async () => {
    const sandbox = mockSandbox();
    await provision(sandbox as unknown as ZeroclawSandbox, defaultOpts());

    // Last writeFiles call should be the .profile
    const lastWrite = sandbox.writeFiles.mock.calls[sandbox.writeFiles.mock.calls.length - 1];
    const files = lastWrite[0];
    const profile = files.find((f) => f.path.endsWith(".profile"));

    expect(profile).toBeDefined();
    expect(profile!.path).toBe("/home/user/.profile");

    const content = profile!.content.toString();
    // binPath is /home/user/.clawrun/bin/zeroclaw → binDir is /home/user/.clawrun/bin → root is /home/user/.clawrun
    expect(content).toContain('CLOUDCLAW_ROOT="/home/user/.clawrun"');
    expect(content).toContain('ZEROCLAW_WORKSPACE="/home/user/.clawrun/agent"');
    expect(content).toContain('ZEROCLAW_CONFIG_DIR="/home/user/.clawrun/agent"');
  });

  it("falls back to /home/vercel-sandbox when $HOME is empty", async () => {
    const sandbox = mockSandbox();
    sandbox.runCommand.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "sh" && args?.[1]?.includes("test -x")) {
        return { exitCode: 0, stdout: async () => "ok\n", stderr: async () => "" };
      }
      // Return empty for $HOME
      if (cmd === "sh" && args?.[1]?.includes("echo")) {
        return { exitCode: 0, stdout: async () => "\n", stderr: async () => "" };
      }
      return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
    });

    await provision(sandbox as unknown as ZeroclawSandbox, defaultOpts());

    const lastWrite = sandbox.writeFiles.mock.calls[sandbox.writeFiles.mock.calls.length - 1];
    const files = lastWrite[0];
    const profile = files.find((f) => f.path.endsWith(".profile"));
    expect(profile).toBeDefined();
    expect(profile!.path).toBe("/home/vercel-sandbox/.profile");
  });

  it("restricts permissions on config.toml and .secret_key", async () => {
    const sandbox = mockSandbox();
    await provision(sandbox as unknown as ZeroclawSandbox, defaultOpts());

    const chmod600 = (sandbox.runCommand.mock.calls as RunCommandArgs[]).find(
      (c) => c[0] === "chmod" && c[1]?.[0] === "600",
    );
    expect(chmod600).toBeDefined();
    expect(chmod600![1]).toContain("/home/user/.clawrun/agent/config.toml");
    expect(chmod600![1]).toContain("/home/user/.clawrun/agent/.secret_key");
  });
});
