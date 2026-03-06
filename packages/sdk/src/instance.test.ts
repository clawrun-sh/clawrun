import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClawRunInstance } from "./instance.js";
import { ProviderNotConfiguredError } from "./errors.js";
import type { InstanceConfig, HistoryResult } from "./types.js";
import type { UIMessage } from "ai";

// Mock dependencies
vi.mock("@clawrun/auth", () => ({
  signAdminToken: vi.fn(async (secret: string) => `admin-jwt-${secret}`),
  signInviteToken: vi.fn(async (secret: string, ttl?: string) => `chat-jwt-${secret}`),
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
    it("start() sends POST to /api/v1/sandbox/start with admin scope", async () => {
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
            Authorization: "Bearer admin-jwt-test-secret",
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

    it("uses chat-scoped token for chat requests", async () => {
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
            Authorization: "Bearer chat-jwt-test-secret",
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
    it("fetches history for a session with chat-scoped token", async () => {
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
        "https://my-agent.vercel.app/api/v1/history?sessionId=sess-1",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer chat-jwt-test-secret",
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

    it("encodes sessionId in URL", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      await instance.getHistory("session with spaces");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("sessionId=session%20with%20spaces"),
        expect.any(Object),
      );
    });
  });

  describe("createInvite", () => {
    it("creates an invite with default TTL (7 days)", async () => {
      const instance = new ClawRunInstance(config, { fetch: mockFetch });
      const invite = await instance.createInvite();

      expect(invite.token).toBe("chat-jwt-test-secret");
      expect(invite.url).toBe("https://my-agent.vercel.app/auth/accept?token=chat-jwt-test-secret");

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
});
