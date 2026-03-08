import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxHandle } from "@clawrun/agent";

// --- Mocks (hoisted) ---

vi.mock("zeroclaw", () => ({
  provision: vi.fn(async () => {}),
  parseCronListOutput: vi.fn(() => ({ jobs: [], nextRunAt: null })),
  buildDaemonCommand: vi.fn(
    (_bin: string, _env: Record<string, string>, opts?: { port?: number }) => ({
      cmd: "/usr/bin/zeroclaw",
      args: ["serve", "--port", String(opts?.port ?? 3000)],
      env: { ZC: "1" },
    }),
  ),
  buildCronListCommand: vi.fn(() => ({
    cmd: "/usr/bin/zeroclaw",
    args: ["cron", "list"],
    env: { ZC: "1" },
  })),
  HOUSEKEEPING_FILES: [".git", "node_modules"],
  DAEMON_PORT: 3000,
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@clawrun/agent", () => ({
  AgentBrowserTool: class {
    id = "agent-browser";
    version = "0.16.3";
    description = "Headless Chromium browser for web browsing and screenshots";
    installDomains = ["*"];
  },
  GhCliTool: class {
    id = "gh-cli";
    version = "2.65.0";
    description = "GitHub CLI for managing repos, issues, and PRs";
    installDomains = ["github.com", "objects.githubusercontent.com", "api.github.com"];
  },
}));

vi.mock("./messaging.js", () => ({
  sendMessageViaCli: vi.fn(async () => ({
    success: true,
    message: "cli response",
    toolCalls: [],
  })),
  sendMessageViaDaemon: vi.fn(async () => ({
    success: true,
    message: "daemon response",
    toolCalls: [],
  })),
  streamMessageViaDaemon: vi.fn(async () => {}),
  listThreadsViaDaemon: vi.fn(async () => [
    {
      id: "clawrun_thread1",
      channel: "ClawRun",
      preview: "hi",
      messageCount: 2,
      lastActivity: "2025-01-01T00:00:00Z",
    },
  ]),
  getThreadViaDaemon: vi.fn(async () => [
    { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
    { id: "m2", role: "assistant", parts: [{ type: "text", text: "hello" }] },
  ]),
}));

vi.mock("./config.js", () => ({
  writeSetupConfig: vi.fn(),
  readSetup: vi.fn(() => null),
}));

vi.mock("./catalog.js", () => ({
  PROVIDERS: [{ name: "openrouter", displayName: "OpenRouter", tier: "recommended" }],
  getDefaultModel: vi.fn(() => "test-model"),
  getCuratedModels: vi.fn(() => []),
  getModelsFetchEndpoint: vi.fn(() => null),
  CHANNELS: [],
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "[browser]\nenabled = true\n"),
  existsSync: vi.fn(() => true),
}));

vi.mock("@iarna/toml", () => ({
  parse: vi.fn(() => ({ browser: { enabled: true } })),
}));

import {
  sendMessageViaDaemon,
  sendMessageViaCli,
  streamMessageViaDaemon,
  listThreadsViaDaemon,
  getThreadViaDaemon,
} from "./messaging.js";
import { parseCronListOutput } from "zeroclaw";
import { existsSync, readFileSync } from "node:fs";
import * as TOML from "@iarna/toml";

function mockSandbox(hasDomain = true) {
  return {
    runCommand: vi.fn(async () => ({
      exitCode: 0,
      stdout: async () => "cron output",
      stderr: async () => "",
    })),
    writeFiles: vi.fn(async () => {}),
    readFile: vi.fn(async () => null),
    domain: hasDomain ? vi.fn((port: number) => `https://sbx.example.com:${port}`) : undefined,
    stop: vi.fn(async () => {}),
    snapshot: vi.fn(async () => "snap-1"),
    extendTimeout: vi.fn(async () => {}),
    updateNetworkPolicy: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ZeroclawAgent", () => {
  let ZeroclawAgent: typeof import("./agent.js").ZeroclawAgent;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./agent.js");
    ZeroclawAgent = mod.ZeroclawAgent;
  });

  describe("sendMessage", () => {
    it("tries daemon WebSocket first when sandbox has domain()", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);

      const result = await agent.sendMessage(sandbox as unknown as SandboxHandle, "/root", "hello");

      expect(sendMessageViaDaemon).toHaveBeenCalledOnce();
      expect(sendMessageViaCli).not.toHaveBeenCalled();
      expect(result.message).toBe("daemon response");
    });

    it("falls back to CLI when daemon WS fails", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      vi.mocked(sendMessageViaDaemon).mockRejectedValueOnce(new Error("connection refused"));

      const result = await agent.sendMessage(sandbox as unknown as SandboxHandle, "/root", "hello");

      expect(sendMessageViaDaemon).toHaveBeenCalledOnce();
      expect(sendMessageViaCli).toHaveBeenCalledOnce();
      expect(result.message).toBe("cli response");
    });

    it("re-throws AbortError without falling back to CLI", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      const abortError = new DOMException("Aborted", "AbortError");
      vi.mocked(sendMessageViaDaemon).mockRejectedValueOnce(abortError);

      await expect(
        agent.sendMessage(sandbox as unknown as SandboxHandle, "/root", "hello"),
      ).rejects.toThrow("Aborted");
      expect(sendMessageViaCli).not.toHaveBeenCalled();
    });

    it("uses CLI directly when sandbox has no domain()", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);

      const result = await agent.sendMessage(sandbox as unknown as SandboxHandle, "/root", "hello");

      expect(sendMessageViaDaemon).not.toHaveBeenCalled();
      expect(sendMessageViaCli).toHaveBeenCalledOnce();
      expect(result.message).toBe("cli response");
    });
  });

  describe("streamMessage", () => {
    const mockWriter = () => ({ write: vi.fn(), merge: vi.fn(), onError: vi.fn() });

    it("delegates to streamMessageViaDaemon when domain is available", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      const writer = mockWriter();

      await agent.streamMessage(sandbox as unknown as SandboxHandle, "/root", "hello", writer);

      expect(streamMessageViaDaemon).toHaveBeenCalledOnce();
    });

    it("falls back to batch sendMessage when no domain", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);
      const writer = mockWriter();

      await agent.streamMessage(sandbox as unknown as SandboxHandle, "/root", "hello", writer);

      expect(streamMessageViaDaemon).not.toHaveBeenCalled();
      expect(sendMessageViaCli).toHaveBeenCalledOnce();
      // Should emit text-start, text-delta, text-end
      const types = writer.write.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types).toContain("text-end");
    });

    it("emits error event when batch sendMessage fails", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);
      const writer = mockWriter();
      vi.mocked(sendMessageViaCli).mockResolvedValueOnce({
        success: false,
        message: "",
        error: "bad request",
        toolCalls: [],
      });

      await agent.streamMessage(sandbox as unknown as SandboxHandle, "/root", "hello", writer);

      const errorCall = writer.write.mock.calls.find(
        (c) => (c[0] as { type: string }).type === "error",
      );
      expect(errorCall).toBeDefined();
      expect((errorCall![0] as { errorText: string }).errorText).toBe("bad request");
    });
  });

  describe("listThreads", () => {
    it("delegates to listThreadsViaDaemon when domain available", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);

      const threads = await agent.listThreads(sandbox as unknown as SandboxHandle, "/root");

      expect(listThreadsViaDaemon).toHaveBeenCalledOnce();
      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe("clawrun_thread1");
    });

    it("returns empty array when no domain", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);

      const threads = await agent.listThreads(sandbox as unknown as SandboxHandle, "/root");

      expect(listThreadsViaDaemon).not.toHaveBeenCalled();
      expect(threads).toEqual([]);
    });

    it("returns empty array on error", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      vi.mocked(listThreadsViaDaemon).mockRejectedValueOnce(new Error("fetch error"));

      const threads = await agent.listThreads(sandbox as unknown as SandboxHandle, "/root");

      expect(threads).toEqual([]);
    });
  });

  describe("getThread", () => {
    it("delegates to getThreadViaDaemon when domain available", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);

      const messages = await agent.getThread(
        sandbox as unknown as SandboxHandle,
        "/root",
        "clawrun_thread1",
      );

      expect(getThreadViaDaemon).toHaveBeenCalledOnce();
      expect(messages).toHaveLength(2);
    });

    it("returns empty array when no domain", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);

      const messages = await agent.getThread(
        sandbox as unknown as SandboxHandle,
        "/root",
        "clawrun_thread1",
      );

      expect(getThreadViaDaemon).not.toHaveBeenCalled();
      expect(messages).toEqual([]);
    });

    it("returns empty array on error", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      vi.mocked(getThreadViaDaemon).mockRejectedValueOnce(new Error("fetch error"));

      const messages = await agent.getThread(
        sandbox as unknown as SandboxHandle,
        "/root",
        "clawrun_thread1",
      );

      expect(messages).toEqual([]);
    });
  });

  describe("getEnabledTools", () => {
    it("returns browser tool when browser.enabled is true", () => {
      const agent = new ZeroclawAgent();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(TOML.parse).mockReturnValue({ browser: { enabled: true } } as ReturnType<
        typeof TOML.parse
      >);

      const tools = agent.getEnabledTools("/agent");

      expect(tools).toHaveLength(1);
      expect(tools[0].id).toBe("agent-browser");
    });

    it("returns empty when config does not exist", () => {
      const agent = new ZeroclawAgent();
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = agent.getEnabledTools("/agent");

      expect(tools).toEqual([]);
    });

    it("returns empty when browser.enabled is false", () => {
      const agent = new ZeroclawAgent();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(TOML.parse).mockReturnValue({ browser: { enabled: false } } as ReturnType<
        typeof TOML.parse
      >);

      const tools = agent.getEnabledTools("/agent");

      expect(tools).toEqual([]);
    });

    it("returns empty on parse error", () => {
      const agent = new ZeroclawAgent();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("bad toml");
      });

      const tools = agent.getEnabledTools("/agent");

      expect(tools).toEqual([]);
    });
  });

  describe("getAvailableTools", () => {
    it("returns all supported tools regardless of config", () => {
      const agent = new ZeroclawAgent();
      const tools = agent.getAvailableTools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.id)).toEqual(["agent-browser", "gh-cli"]);
    });
  });

  describe("getCrons", () => {
    it("runs cron-list command and parses output", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      vi.mocked(parseCronListOutput).mockReturnValue({
        jobs: [{ schedule: "0 * * * *", task: "check" }],
        nextRunAt: 1234,
      } as unknown as ReturnType<typeof parseCronListOutput>);

      const result = await agent.getCrons(sandbox as unknown as SandboxHandle, "/root");

      expect(sandbox.runCommand).toHaveBeenCalledOnce();
      expect(parseCronListOutput).toHaveBeenCalledWith("cron output");
      expect(result.jobs).toHaveLength(1);
    });
  });

  describe("getDaemonCommand", () => {
    it("builds daemon command with correct env", () => {
      const agent = new ZeroclawAgent();
      const cmd = agent.getDaemonCommand("/root");

      expect(cmd.cmd).toBe("/usr/bin/zeroclaw");
      expect(cmd.env).toHaveProperty("ZC");
    });

    it("merges extra env from opts", () => {
      const agent = new ZeroclawAgent();
      const cmd = agent.getDaemonCommand("/root", { env: { EXTRA: "val" } });

      expect(cmd.env.EXTRA).toBe("val");
    });
  });
});
