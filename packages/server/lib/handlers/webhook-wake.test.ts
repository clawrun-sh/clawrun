import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clawrun/channel", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("@clawrun/runtime", () => ({
  getAgent: vi.fn(),
  getRuntimeConfig: vi.fn(() => ({ instance: { provider: "vercel" } })),
  resolveRoot: vi.fn(async () => "/agent"),
  SandboxLifecycleManager: vi.fn(),
}));

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { getAdapter } from "@clawrun/channel";
import { getProvider } from "@clawrun/provider";
import { getAgent, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import type { WakeHookAdapter } from "@clawrun/channel";
import type { SandboxProvider } from "@clawrun/provider";
import type { Agent } from "@clawrun/agent";
import { handleWakeWebhook, handleWakeWebhookGet } from "./webhook-wake.js";

function mockAdapter(overrides: Record<string, unknown> = {}) {
  return {
    channelId: "telegram",
    name: "Telegram",
    programmableWebhook: true,
    wakeResponseStatus: 503,
    registerWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    verifyRequest: vi.fn(async () => ({ valid: true })),
    handleChallenge: undefined,
    parseWakeSignal: vi.fn(() => ({
      channelId: "telegram",
      chatId: "12345",
      messageText: "Hello agent",
      rawPayload: {},
    })),
    handleVerifyGet: undefined,
    sendMessage: vi.fn(async () => {}),
    ...overrides,
  };
}

function mockManager(overrides: Record<string, unknown> = {}) {
  return {
    wake: vi.fn(async () => ({ status: "running", sandboxId: "sbx-1" })),
    getStatus: vi.fn(async () => ({ running: false })),
    teardownWakeHooks: vi.fn(async () => {}),
    ...overrides,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/webhook/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleWakeWebhookGet", () => {
  it("returns 404 for unknown channel", async () => {
    vi.mocked(getAdapter).mockReturnValue(undefined);
    const req = new Request("http://localhost");
    const resp = await handleWakeWebhookGet(req, "unknown");
    expect(resp.status).toBe(404);
  });

  it("returns 405 when adapter has no handleVerifyGet", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = new Request("http://localhost");
    const resp = await handleWakeWebhookGet(req, "telegram");
    expect(resp.status).toBe(405);
  });

  it("delegates to handleVerifyGet when present", async () => {
    const adapter = mockAdapter({
      handleVerifyGet: vi.fn(() => new Response("challenge-ok", { status: 200 })),
    });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = new Request("http://localhost?hub.challenge=abc");
    const resp = await handleWakeWebhookGet(req, "telegram");
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("challenge-ok");
  });

  it("returns 405 when handleVerifyGet returns null", async () => {
    const adapter = mockAdapter({
      handleVerifyGet: vi.fn(() => null),
    });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = new Request("http://localhost");
    const resp = await handleWakeWebhookGet(req, "telegram");
    expect(resp.status).toBe(405);
  });
});

describe("handleWakeWebhook", () => {
  it("returns 404 for unknown channel", async () => {
    vi.mocked(getAdapter).mockReturnValue(undefined);
    const req = jsonRequest({ text: "hi" });
    const resp = await handleWakeWebhook(req, "unknown");
    expect(resp.status).toBe(404);
  });

  it("returns 400 when body read fails", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const errorStream = new ReadableStream({
      start(controller) {
        controller.error(new Error("read error"));
      },
    });
    const req = new Request("http://localhost", {
      method: "POST",
      body: errorStream,
      // @ts-expect-error -- duplex required for streaming body in Node
      duplex: "half",
    });
    const resp = await handleWakeWebhook(req, "telegram");
    expect(resp.status).toBe(400);
  });

  it("returns 401 when verification fails", async () => {
    const adapter = mockAdapter({
      verifyRequest: vi.fn(async () => ({ valid: false, error: "Bad signature" })),
    });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = jsonRequest({ text: "hi" });
    const resp = await handleWakeWebhook(req, "telegram");
    expect(resp.status).toBe(401);
  });

  it("returns 500 when verification error is Server misconfigured", async () => {
    const adapter = mockAdapter({
      verifyRequest: vi.fn(async () => ({ valid: false, error: "Server misconfigured" })),
    });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = jsonRequest({ text: "hi" });
    const resp = await handleWakeWebhook(req, "telegram");
    expect(resp.status).toBe(500);
  });

  it("returns 400 for non-JSON body", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = new Request("http://localhost", {
      method: "POST",
      body: "not-valid-json{{{",
    });
    const resp = await handleWakeWebhook(req, "telegram");
    expect(resp.status).toBe(400);
  });

  it("returns challenge response when handleChallenge returns one", async () => {
    const adapter = mockAdapter({
      handleChallenge: vi.fn(() => new Response(JSON.stringify({ type: 1 }), { status: 200 })),
    });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = jsonRequest({ type: 1 });
    const resp = await handleWakeWebhook(req, "telegram");
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.type).toBe(1);
  });

  it("returns 200 when parseWakeSignal returns null", async () => {
    const adapter = mockAdapter({
      parseWakeSignal: vi.fn(() => null),
    });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);
    const req = jsonRequest({ edited_message: {} });
    const resp = await handleWakeWebhook(req, "telegram");
    expect(resp.status).toBe(200);
  });

  it("always-on channel returns 200 when sandbox already running", async () => {
    const adapter = mockAdapter({ programmableWebhook: false, wakeResponseStatus: 200 });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager({ getStatus: vi.fn(async () => ({ running: true })) });
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    const req = jsonRequest({ message: { text: "hi" } });
    const resp = await handleWakeWebhook(req, "slack");
    expect(resp.status).toBe(200);
    expect(manager.wake).not.toHaveBeenCalled();
  });

  it("always-on channel proceeds with wake when getStatus throws", async () => {
    const adapter = mockAdapter({ programmableWebhook: false, wakeResponseStatus: 200 });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager({
      getStatus: vi.fn(async () => {
        throw new Error("state unavailable");
      }),
    });
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    // Mock provider for message forwarding
    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => ({})),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue({
      sendMessage: vi.fn(async () => ({ success: true, message: "ok" })),
    } as unknown as Agent);

    const req = jsonRequest({ message: { text: "hi" } });
    const resp = await handleWakeWebhook(req, "slack");
    expect(resp.status).toBe(200);
    expect(manager.wake).toHaveBeenCalled();
  });

  it("sends courtesy message when chatId present and not acknowledged", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager();
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => ({})),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue({
      sendMessage: vi.fn(async () => ({ success: true, message: "ok" })),
    } as unknown as Agent);

    const req = jsonRequest({ message: { text: "hi" } });
    await handleWakeWebhook(req, "telegram");
    expect(adapter.sendMessage).toHaveBeenCalledWith("12345", "Waking up, one moment...");
  });

  it("skips courtesy message when acknowledged is true", async () => {
    const adapter = mockAdapter({
      parseWakeSignal: vi.fn(() => ({
        channelId: "discord",
        chatId: "99",
        messageText: "hi",
        rawPayload: {},
        acknowledged: true,
      })),
    });
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager();
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => ({})),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue({
      sendMessage: vi.fn(async () => ({ success: true, message: "ok" })),
    } as unknown as Agent);

    const req = jsonRequest({ type: 2, data: {} });
    await handleWakeWebhook(req, "discord");

    // sendMessage should only be called once (forwarding response), not for courtesy
    const courtesyCalls = adapter.sendMessage.mock.calls.filter(
      (c: unknown[]) => c[1] === "Waking up, one moment...",
    );
    expect(courtesyCalls.length).toBe(0);
  });

  it("wakes with skipTeardownWakeHooks: true", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager();
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => ({})),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue({
      sendMessage: vi.fn(async () => ({ success: true, message: "ok" })),
    } as unknown as Agent);

    const req = jsonRequest({ message: { text: "hi" } });
    await handleWakeWebhook(req, "telegram");
    expect(manager.wake).toHaveBeenCalledWith({ skipTeardownWakeHooks: true });
  });

  it("forwards message to agent and sends response via adapter", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager();
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    const mockSandbox = { id: "sbx-1" };
    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => mockSandbox),
    } as unknown as SandboxProvider);
    vi.mocked(resolveRoot).mockResolvedValue("/agent");

    const agentSendMessage = vi.fn(async () => ({ success: true, message: "Agent reply" }));
    vi.mocked(getAgent).mockReturnValue({ sendMessage: agentSendMessage } as unknown as Agent);

    const req = jsonRequest({ message: { text: "hi" } });
    await handleWakeWebhook(req, "telegram");

    expect(agentSendMessage).toHaveBeenCalledWith(
      mockSandbox,
      "/agent",
      "Hello agent",
      expect.objectContaining({ threadId: "telegram-12345" }),
    );
    expect(adapter.sendMessage).toHaveBeenCalledWith("12345", "Agent reply");
  });

  it("tears down hooks after successful flow", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager();
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => ({})),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue({
      sendMessage: vi.fn(async () => ({ success: true, message: "ok" })),
    } as unknown as Agent);

    const req = jsonRequest({ message: { text: "hi" } });
    await handleWakeWebhook(req, "telegram");
    expect(manager.teardownWakeHooks).toHaveBeenCalled();
  });

  it("tears down hooks even on wake failure", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager({
      wake: vi.fn(async () => {
        throw new Error("wake failed");
      }),
    });
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    const req = jsonRequest({ message: { text: "hi" } });
    const resp = await handleWakeWebhook(req, "telegram");
    expect(manager.teardownWakeHooks).toHaveBeenCalled();
    expect(resp.status).toBe(503); // adapter.wakeResponseStatus
  });

  it("does not forward message when wake result is not running", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager({
      wake: vi.fn(async () => ({ status: "failed", sandboxId: undefined })),
    });
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    const agentSendMessage = vi.fn();
    vi.mocked(getAgent).mockReturnValue({ sendMessage: agentSendMessage } as unknown as Agent);

    const req = jsonRequest({ message: { text: "hi" } });
    await handleWakeWebhook(req, "telegram");
    expect(agentSendMessage).not.toHaveBeenCalled();
  });

  it("does not crash when agent message forwarding throws", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager();
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => {
        throw new Error("provider error");
      }),
    } as unknown as SandboxProvider);

    const req = jsonRequest({ message: { text: "hi" } });
    const resp = await handleWakeWebhook(req, "telegram");
    // Should still return 200 and tear down hooks
    expect(resp.status).toBe(200);
    expect(manager.teardownWakeHooks).toHaveBeenCalled();
  });

  it("does not send agent response when agent returns unsuccessful", async () => {
    const adapter = mockAdapter();
    vi.mocked(getAdapter).mockReturnValue(adapter as unknown as WakeHookAdapter);

    const manager = mockManager();
    vi.mocked(SandboxLifecycleManager).mockImplementation(
      () => manager as unknown as SandboxLifecycleManager,
    );

    vi.mocked(getProvider).mockReturnValue({
      get: vi.fn(async () => ({})),
    } as unknown as SandboxProvider);
    vi.mocked(getAgent).mockReturnValue({
      sendMessage: vi.fn(async () => ({ success: false, error: "agent error" })),
    } as unknown as Agent);

    const req = jsonRequest({ message: { text: "hi" } });
    await handleWakeWebhook(req, "telegram");

    // sendMessage called once for courtesy, NOT for agent response
    const responseCalls = adapter.sendMessage.mock.calls.filter(
      (c: unknown[]) => c[1] !== "Waking up, one moment...",
    );
    expect(responseCalls.length).toBe(0);
  });
});
