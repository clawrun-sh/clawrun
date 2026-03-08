import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClawRunInstance } from "./instance.js";
import { ProviderNotConfiguredError } from "./errors.js";
import type { InstanceConfig, HistoryResult } from "./types.js";
import type { UIMessage } from "ai";

// Mock dependencies
vi.mock("@clawrun/auth", () => ({
  signUserToken: vi.fn(async (secret: string) => `user-jwt-${secret}`),
  signInviteToken: vi.fn(async (secret: string, ttl?: string) => `invite-jwt-${secret}`),
}));

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(() => ({
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    listSnapshots: vi.fn().mockResolvedValue([]),
    deleteSnapshot: vi.fn(),
  })),
}));

describe("ClawRunInstance", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let config: InstanceConfig;

  beforeEach(() => {
    mockFetch = vi.fn();
    config = {
      api: { url: "https://my-agent.vercel.app", jwtSecret: "test-secret" },
    };
  });

  describe("constructor and getters", () => {
    it("exposes the web URL", () => {
      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      expect(instance.webUrl).toBe("https://my-agent.vercel.app");
    });
  });

  describe("lifecycle methods", () => {
    it("start() sends POST to /api/v1/sandbox/start with user scope", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ status: "running", sandboxId: "sbx-1" }), { status: 200 }),
      );

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.start();

      expect(result).toEqual({ status: "running", sandboxId: "sbx-1" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/sandbox/start",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer user-jwt-test-secret",
          }),
        }),
      );
    });

    it("stop() sends POST to /api/v1/sandbox/stop", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ status: "stopped" }), { status: 200 }),
      );

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.stop();

      expect(result).toEqual({ status: "stopped" });
    });

    it("restart() sends POST to /api/v1/sandbox/restart", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ status: "running" }), { status: 200 }),
      );

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.restart();

      expect(result).toEqual({ status: "running" });
    });

    it("health() sends GET to /api/v1/health", async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ok",
            agent: "zeroclaw",
            sandbox: { running: true },
          }),
          { status: 200 },
        ),
      );

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.health();

      expect(result).toEqual({
        status: "ok",
        agent: "zeroclaw",
        sandbox: { running: true },
      });
    });

    it("passes abort signal to lifecycle methods", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ status: "running" }), { status: 200 }),
      );

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const controller = new AbortController();
      await instance.start(controller.signal);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  describe("chat", () => {
    it("returns a UIMessage that can be consumed via result()", async () => {
      // Simulate an SSE response
      const sseData = [
        `data: ${JSON.stringify({ type: "text-start", id: "t1" })}\n\n`,
        `data: ${JSON.stringify({ type: "text-delta", id: "t1", delta: "Hi" })}\n\n`,
        `data: ${JSON.stringify({ type: "text-end", id: "t1" })}\n\n`,
        `data: [DONE]\n\n`,
      ].join("");
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const msg: UIMessage = await instance.sendMessage("Hello");

      expect(msg.role).toBe("assistant");
      expect(msg.parts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "text", text: "Hi" })]),
      );
    });

    it("uses user-scoped token for chat requests", async () => {
      const sseData = `data: [DONE]\n\n`;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.sendMessage("Hello");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/chat",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer user-jwt-test-secret",
          }),
        }),
      );
    });

    it("chat() is lazy - does not trigger HTTP until iterated", () => {
      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      instance.chat("Hello");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("getHistory", () => {
    it("fetches history for a session with user-scoped token", async () => {
      const historyResponse: HistoryResult = {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello!" },
        ],
      };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(historyResponse), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const history = await instance.getHistory("sess-1");

      expect(history).toEqual(historyResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/history?threadId=sess-1",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer user-jwt-test-secret",
          }),
        }),
      );
    });

    it("returns empty messages array when no history", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const history = await instance.getHistory("sess-1");

      expect(history.messages).toEqual([]);
    });

    it("encodes threadId in URL", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.getHistory("session with spaces");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("threadId=session%20with%20spaces"),
        expect.any(Object),
      );
    });
  });

  describe("createInvite", () => {
    it("creates an invite with default TTL (7 days)", async () => {
      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const invite = await instance.createInvite();

      expect(invite.token).toBe("invite-jwt-test-secret");
      expect(invite.url).toBe(
        "https://my-agent.vercel.app/auth/accept?token=invite-jwt-test-secret",
      );

      const { signInviteToken } = await import("@clawrun/auth");
      expect(signInviteToken).toHaveBeenCalledWith("test-secret", `${7 * 24 * 60 * 60}s`);
    });

    it("creates an invite with custom TTL", async () => {
      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.createInvite(3600);

      const { signInviteToken } = await import("@clawrun/auth");
      expect(signInviteToken).toHaveBeenCalledWith("test-secret", "3600s");
    });
  });

  describe("sandbox access", () => {
    it("throws ProviderNotConfiguredError when no sandbox config", () => {
      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      expect(() => instance.sandbox).toThrow(ProviderNotConfiguredError);
    });

    it("returns SandboxClient when provider is configured", () => {
      const configWithSandbox: InstanceConfig = {
        ...config,
        sandbox: { provider: "vercel", providerOptions: { projectDir: "/tmp" } },
      };
      const instance = new ClawRunInstance(configWithSandbox, { fetch: mockFetch });
      expect(instance.sandbox).toBeDefined();
    });

    it("lazily initializes SandboxClient (returns same instance)", () => {
      const configWithSandbox: InstanceConfig = {
        ...config,
        sandbox: { provider: "vercel" },
      };
      const instance = new ClawRunInstance(configWithSandbox, { fetch: mockFetch });
      const sb1 = instance.sandbox;
      const sb2 = instance.sandbox;
      expect(sb1).toBe(sb2);
    });
  });

  describe("destroySandboxes", () => {
    it("stops running sandboxes and deletes all snapshots", async () => {
      const configWithSandbox: InstanceConfig = {
        ...config,
        sandbox: { provider: "vercel" },
      };
      const instance = new ClawRunInstance(configWithSandbox, { fetch: mockFetch });

      // The mock provider returns [] for both list and listSnapshots
      // so this should complete without error
      await instance.destroySandboxes();
    });
  });

  describe("agent query methods", () => {
    it("getStatus() sends GET to /api/v1/status", async () => {
      const statusData = { provider: "openrouter", model: "gpt-4", uptime: 3600 };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(statusData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.getStatus();

      expect(result).toEqual(statusData);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/status",
        expect.any(Object),
      );
    });

    it("getCost() sends GET to /api/v1/cost", async () => {
      const costData = { sessionCost: 0.05, totalTokens: 1000 };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(costData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.getCost();

      expect(result).toEqual(costData);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/cost",
        expect.any(Object),
      );
    });

    it("getConfig() sends GET to /api/v1/config", async () => {
      const configData = { format: "toml", content: "[agent]\nname = 'z'" };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(configData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.getConfig();

      expect(result).toEqual(configData);
    });

    it("listTools() sends GET to /api/v1/tools", async () => {
      const toolsData = { tools: [{ name: "search" }], cliTools: [{ name: "git" }] };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(toolsData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.listTools();

      expect(result).toEqual(toolsData);
    });

    it("runDiagnostics() sends GET to /api/v1/diagnostics", async () => {
      const diagData = { results: [{ category: "api", message: "ok", severity: "ok" }] };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(diagData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.runDiagnostics();

      expect(result).toEqual(diagData);
    });
  });

  describe("thread methods", () => {
    it("listThreads() sends GET to /api/v1/threads", async () => {
      const threadsData = {
        threads: [
          { id: "t1", channel: "web", preview: "hi", messageCount: 2, lastActivity: "2026-01-01" },
        ],
      };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(threadsData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.listThreads();

      expect(result).toEqual(threadsData);
    });

    it("getThread() sends GET to /api/v1/threads/:id", async () => {
      const threadData = { messages: [{ role: "user", content: "hello" }] };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(threadData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.getThread("t1");

      expect(result).toEqual(threadData);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/threads/t1",
        expect.any(Object),
      );
    });

    it("getThread() encodes thread ID", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.getThread("thread with spaces");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/threads/thread%20with%20spaces"),
        expect.any(Object),
      );
    });
  });

  describe("memory methods", () => {
    it("listMemories() sends GET to /api/v1/memory", async () => {
      const memData = { entries: [{ key: "k1", content: "v1" }] };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(memData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.listMemories();

      expect(result).toEqual(memData);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/memory",
        expect.any(Object),
      );
    });

    it("listMemories() appends query params", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ entries: [] }), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.listMemories({ query: "test", category: "facts" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/memory?query=test&category=facts",
        expect.any(Object),
      );
    });

    it("listMemories() without options sends no query params", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ entries: [] }), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.listMemories();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/memory",
        expect.any(Object),
      );
    });

    it("createMemory() sends POST to /api/v1/memory", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.createMemory({ key: "k1", content: "v1", category: "test" });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/memory",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ key: "k1", content: "v1", category: "test" }),
        }),
      );
    });

    it("deleteMemory() sends DELETE to /api/v1/memory/:key", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.deleteMemory("k1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/memory/k1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("deleteMemory() encodes key", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.deleteMemory("key with spaces");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/memory/key%20with%20spaces"),
        expect.any(Object),
      );
    });
  });

  describe("cron methods", () => {
    it("listCronJobs() sends GET to /api/v1/cron", async () => {
      const cronData = { jobs: [{ id: "c1", schedule: "0 * * * *", command: "check" }] };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(cronData), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.listCronJobs();

      expect(result).toEqual(cronData);
    });

    it("createCronJob() sends POST to /api/v1/cron", async () => {
      const newJob = { id: "c2", schedule: "*/5 * * * *", command: "ping" };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(newJob), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const result = await instance.createCronJob({ schedule: "*/5 * * * *", command: "ping" });

      expect(result).toEqual(newJob);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/cron",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ schedule: "*/5 * * * *", command: "ping" }),
        }),
      );
    });

    it("deleteCronJob() sends DELETE to /api/v1/cron/:id", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.deleteCronJob("c1");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://my-agent.vercel.app/api/v1/cron/c1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("browser() factory", () => {
    it("creates instance with empty base URL by default", () => {
      const instance = ClawRunInstance.browser();
      expect(instance.webUrl).toBe("");
    });

    it("creates instance with custom base URL", () => {
      const instance = ClawRunInstance.browser("https://my-agent.vercel.app");
      expect(instance.webUrl).toBe("https://my-agent.vercel.app");
    });

    it("uses cookie mode (no Authorization header)", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
      // Attach mock fetch globally for browser() since it uses globalThis.fetch
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const instance = ClawRunInstance.browser("https://my-agent.vercel.app");
        await instance.health();

        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.headers).not.toHaveProperty("Authorization");
        expect(callArgs.credentials).toBe("same-origin");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
