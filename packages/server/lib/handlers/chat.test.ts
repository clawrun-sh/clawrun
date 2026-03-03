import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for chat handler message extraction logic.
 *
 * We mock all heavy dependencies (runtime, provider, agent, auth) and focus
 * on the request parsing / validation surface of the POST handler.
 */

vi.mock("@clawrun/runtime", () => ({
  getAgent: vi.fn(() => ({
    sendMessage: vi.fn(async () => ({ success: true, message: "ok" })),
  })),
  getRuntimeConfig: vi.fn(() => ({
    instance: { provider: "vercel" },
  })),
  resolveRoot: vi.fn(async () => "/agent"),
  SandboxLifecycleManager: vi.fn(() => ({
    wake: vi.fn(async () => ({ status: "ready", sandboxId: "sbx-1" })),
  })),
}));

vi.mock("@clawrun/provider", () => ({
  getProvider: vi.fn(() => ({
    get: vi.fn(async () => ({})),
  })),
}));

vi.mock("@clawrun/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock auth to always pass
vi.mock("../auth/session", () => ({
  requireSessionOrBearerAuth: vi.fn(async () => null),
}));

// Mock `ai` — we return a simple passthrough Response
vi.mock("ai", () => ({
  createUIMessageStreamResponse: ({ stream }: { stream: ReadableStream }) =>
    new Response(stream, { status: 200 }),
  createUIMessageStream: ({
    execute,
  }: {
    execute: (opts: { writer: { write: (e: unknown) => void } }) => Promise<void>;
  }) => {
    const events: unknown[] = [];
    const writer = { write: (e: unknown) => events.push(e) };
    // Execute synchronously enough for our tests
    const promise = execute({ writer });
    // Return a ReadableStream that waits for execution then closes
    return new ReadableStream({
      async start(controller) {
        await promise;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(events)));
        controller.close();
      },
    });
  },
}));

describe("chat handler POST", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("./chat.js");
    POST = mod.POST;
  });

  it('extracts from {message: "text"} format', async () => {
    const req = new Request("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
  });

  it("extracts last message from {messages} array", async () => {
    const req = new Request("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "first" },
          { role: "user", content: "second" },
        ],
      }),
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
  });

  it("extracts from parts array (type: text)", async () => {
    const req = new Request("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: "from parts" }] }],
      }),
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
  });

  it("rejects empty message", async () => {
    const req = new Request("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });

  it("rejects message exceeding MAX_MESSAGE_LENGTH", async () => {
    const req = new Request("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(33_000) }),
    });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });
});
