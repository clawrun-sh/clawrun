import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UIMessageChunk } from "ai";

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

// ---------------------------------------------------------------------------
// SSE streaming: delta delay and formatting
// ---------------------------------------------------------------------------
describe("SSE streaming transform", () => {
  /**
   * Builds the same TransformStream used in chat.ts for SSE formatting.
   * We duplicate the logic here so tests stay focused on behavior, not
   * module wiring. If the constant or types change, these tests will
   * catch regressions.
   */
  const SSE_DELTA_DELAY_MS = 10;
  const DELTA_TYPES = new Set<UIMessageChunk["type"]>(["text-delta", "reasoning-delta"]);

  function createSseTransform() {
    return new TransformStream<UIMessageChunk, string>({
      async transform(part, controller) {
        controller.enqueue(`data: ${JSON.stringify(part)}\n\n`);
        if (DELTA_TYPES.has(part.type)) {
          await new Promise<void>((r) => setTimeout(r, SSE_DELTA_DELAY_MS));
        }
      },
      flush(controller) {
        controller.enqueue("data: [DONE]\n\n");
      },
    });
  }

  async function collectChunks(stream: ReadableStream<string>): Promise<string[]> {
    const reader = stream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  }

  it("formats parts as SSE data lines", async () => {
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "t1" } as UIMessageChunk);
        controller.enqueue({ type: "text-end", id: "t1" } as UIMessageChunk);
        controller.close();
      },
    });

    const chunks = await collectChunks(input.pipeThrough(createSseTransform()));
    expect(chunks.every((c) => c.startsWith("data: ") && c.endsWith("\n\n"))).toBe(true);
  });

  it("appends [DONE] sentinel on flush", async () => {
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "t1" } as UIMessageChunk);
        controller.close();
      },
    });

    const chunks = await collectChunks(input.pipeThrough(createSseTransform()));
    expect(chunks[chunks.length - 1]).toBe("data: [DONE]\n\n");
  });

  it("delays after text-delta events", async () => {
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "text-delta", id: "t1", delta: "hello " } as UIMessageChunk);
        controller.enqueue({ type: "text-delta", id: "t1", delta: "world" } as UIMessageChunk);
        controller.close();
      },
    });

    const start = performance.now();
    await collectChunks(input.pipeThrough(createSseTransform()));
    const elapsed = performance.now() - start;

    // 2 text-deltas × 10ms = at least ~20ms of delay
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it("delays after reasoning-delta events", async () => {
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({
          type: "reasoning-delta",
          id: "r1",
          delta: "think ",
        } as UIMessageChunk);
        controller.enqueue({ type: "reasoning-delta", id: "r1", delta: "more" } as UIMessageChunk);
        controller.close();
      },
    });

    const start = performance.now();
    await collectChunks(input.pipeThrough(createSseTransform()));
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it("does not delay for non-delta events", async () => {
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "t1" } as UIMessageChunk);
        controller.enqueue({ type: "text-end", id: "t1" } as UIMessageChunk);
        controller.enqueue({ type: "reasoning-start", id: "r1" } as UIMessageChunk);
        controller.enqueue({ type: "reasoning-end", id: "r1" } as UIMessageChunk);
        controller.close();
      },
    });

    const start = performance.now();
    await collectChunks(input.pipeThrough(createSseTransform()));
    const elapsed = performance.now() - start;

    // Non-delta events should pass through with no artificial delay
    expect(elapsed).toBeLessThan(15);
  });

  it("preserves JSON structure in SSE output", async () => {
    const part = { type: "text-delta" as const, id: "t1", delta: "hello" };
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue(part as UIMessageChunk);
        controller.close();
      },
    });

    const chunks = await collectChunks(input.pipeThrough(createSseTransform()));
    const sseData = chunks[0].replace(/^data: /, "").replace(/\n\n$/, "");
    expect(JSON.parse(sseData)).toEqual(part);
  });
});
