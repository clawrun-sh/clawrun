import { describe, it, expect, vi, beforeEach } from "vitest";

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
    installDomains = ["*"];
  },
}));

vi.mock("./messaging.js", () => ({
  sendMessageViaCli: vi.fn(async () => ({
    success: true,
    message: "cli response",
    toolCalls: [],
  })),
}));

vi.mock("./ws-client.js", () => ({
  sendMessage: vi.fn(async () => ({
    success: true,
    message: "daemon response",
    toolCalls: [],
  })),
  streamMessage: vi.fn(async () => {}),
  fetchHistory: vi.fn(async () => [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
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

import { sendMessageViaCli } from "./messaging.js";
import {
  sendMessage as sendMessageViaDaemon,
  streamMessage as streamMessageViaDaemon,
  fetchHistory as fetchHistoryViaDaemon,
} from "./ws-client.js";
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

      const result = await agent.sendMessage(sandbox as any, "/root", "hello");

      expect(sendMessageViaDaemon).toHaveBeenCalledOnce();
      expect(sendMessageViaCli).not.toHaveBeenCalled();
      expect(result.message).toBe("daemon response");
    });

    it("falls back to CLI when daemon WS fails", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      vi.mocked(sendMessageViaDaemon).mockRejectedValueOnce(new Error("connection refused"));

      const result = await agent.sendMessage(sandbox as any, "/root", "hello");

      expect(sendMessageViaDaemon).toHaveBeenCalledOnce();
      expect(sendMessageViaCli).toHaveBeenCalledOnce();
      expect(result.message).toBe("cli response");
    });

    it("re-throws AbortError without falling back to CLI", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      const abortError = new DOMException("Aborted", "AbortError");
      vi.mocked(sendMessageViaDaemon).mockRejectedValueOnce(abortError);

      await expect(agent.sendMessage(sandbox as any, "/root", "hello")).rejects.toThrow("Aborted");
      expect(sendMessageViaCli).not.toHaveBeenCalled();
    });

    it("uses CLI directly when sandbox has no domain()", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);

      const result = await agent.sendMessage(sandbox as any, "/root", "hello");

      expect(sendMessageViaDaemon).not.toHaveBeenCalled();
      expect(sendMessageViaCli).toHaveBeenCalledOnce();
      expect(result.message).toBe("cli response");
    });
  });

  describe("streamMessage", () => {
    it("delegates to streamMessageViaDaemon when domain is available", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      const writer = { write: vi.fn() };

      await agent.streamMessage(sandbox as any, "/root", "hello", writer);

      expect(streamMessageViaDaemon).toHaveBeenCalledOnce();
    });

    it("falls back to batch sendMessage when no domain", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);
      const writer = { write: vi.fn() };

      await agent.streamMessage(sandbox as any, "/root", "hello", writer);

      expect(streamMessageViaDaemon).not.toHaveBeenCalled();
      expect(sendMessageViaCli).toHaveBeenCalledOnce();
      // Should emit text-start, text-delta, text-end
      const types = writer.write.mock.calls.map((c: any) => c[0].type);
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types).toContain("text-end");
    });

    it("emits error event when batch sendMessage fails", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);
      const writer = { write: vi.fn() };
      vi.mocked(sendMessageViaCli).mockResolvedValueOnce({
        success: false,
        message: "",
        error: "bad request",
        toolCalls: [],
      });

      await agent.streamMessage(sandbox as any, "/root", "hello", writer);

      const errorCall = writer.write.mock.calls.find((c: any) => c[0].type === "error");
      expect(errorCall).toBeDefined();
      expect(errorCall![0].errorText).toBe("bad request");
    });
  });

  describe("fetchHistory", () => {
    it("delegates to fetchHistoryViaDaemon when domain available", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);

      const messages = await agent.fetchHistory(sandbox as any, "/root", "session-1");

      expect(fetchHistoryViaDaemon).toHaveBeenCalledOnce();
      expect(messages).toHaveLength(2);
    });

    it("returns empty array when no domain", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(false);

      const messages = await agent.fetchHistory(sandbox as any, "/root", "session-1");

      expect(fetchHistoryViaDaemon).not.toHaveBeenCalled();
      expect(messages).toEqual([]);
    });

    it("returns empty array on error", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      vi.mocked(fetchHistoryViaDaemon).mockRejectedValueOnce(new Error("ws error"));

      const messages = await agent.fetchHistory(sandbox as any, "/root", "session-1");

      expect(messages).toEqual([]);
    });
  });

  describe("getEnabledTools", () => {
    it("returns browser tool when browser.enabled is true", () => {
      const agent = new ZeroclawAgent();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(TOML.parse).mockReturnValue({ browser: { enabled: true } } as any);

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
      vi.mocked(TOML.parse).mockReturnValue({ browser: { enabled: false } } as any);

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

  describe("getCrons", () => {
    it("runs cron-list command and parses output", async () => {
      const agent = new ZeroclawAgent();
      const sandbox = mockSandbox(true);
      vi.mocked(parseCronListOutput).mockReturnValue({
        jobs: [{ schedule: "0 * * * *", task: "check" }],
        nextRunAt: 1234,
      } as any);

      const result = await agent.getCrons(sandbox as any, "/root");

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
