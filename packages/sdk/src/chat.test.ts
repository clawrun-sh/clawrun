import { describe, it, expect, vi } from "vitest";
import { createChatStream } from "./chat.js";
import { ChatStreamError } from "./errors.js";
import type { ApiClient } from "./api-client.js";
import type { UIMessageChunk, UIMessage } from "ai";

/**
 * Create a mock SSE response body from an array of SSE event data payloads.
 */
function mockSseResponse(events: string[]): Response {
  const lines = events.map((data) => `data: ${data}\n\n`).join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createMockApiClient(response: Response): ApiClient {
  return {
    rawPost: vi.fn().mockResolvedValue(response),
    url: "https://example.com",
  } as unknown as ApiClient;
}

describe("createChatStream", () => {
  describe("async iteration", () => {
    it("yields UIMessageChunk events as-is from the server", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "Hello" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: " world" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test message");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hello" },
        { type: "text-delta", id: "t1", delta: " world" },
        { type: "text-end", id: "t1" },
      ]);
    });

    it("yields reasoning events", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "reasoning-start", id: "r1" }),
        JSON.stringify({ type: "reasoning-delta", id: "r1", delta: "thinking..." }),
        JSON.stringify({ type: "reasoning-end", id: "r1" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: "thinking..." },
        { type: "reasoning-end", id: "r1" },
      ]);
    });

    it("passes through tool-input-available events (no renaming)", async () => {
      const response = mockSseResponse([
        JSON.stringify({
          type: "tool-input-available",
          toolCallId: "tc1",
          toolName: "search",
          input: { query: "test" },
        }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          type: "tool-input-available",
          toolCallId: "tc1",
          toolName: "search",
          input: { query: "test" },
        },
      ]);
    });

    it("passes through tool-output-available events", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "tool-output-available", toolCallId: "tc1", output: "result text" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "tool-output-available", toolCallId: "tc1", output: "result text" },
      ]);
    });

    it("yields error events when iterating", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "error", errorText: "something failed" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toEqual([{ type: "error", errorText: "something failed" }]);
    });

    it("skips malformed event data", async () => {
      const response = mockSseResponse([
        "not valid json",
        JSON.stringify({ type: "text-delta", id: "t1", delta: "valid" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toEqual([{ type: "text-delta", id: "t1", delta: "valid" }]);
    });

    it("passes through unknown event types (no filtering)", async () => {
      const response = mockSseResponse([
        JSON.stringify({
          type: "source-url",
          sourceId: "s1",
          url: "https://example.com",
          title: "Example",
        }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "valid" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: "source-url",
        sourceId: "s1",
        url: "https://example.com",
        title: "Example",
      });
      expect(events[1]).toEqual({ type: "text-delta", id: "t1", delta: "valid" });
    });

    it("handles empty response body", async () => {
      const response = new Response(null, { status: 200 });
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toEqual([]);
    });

    it("prevents double consumption", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "text-delta", id: "t1", delta: "Hello" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");

      // First consumption succeeds
      const events: UIMessageChunk[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      expect(events.length).toBe(1);

      // Second consumption throws
      await expect(async () => {
        for await (const _event of stream) {
          // should not get here
        }
      }).rejects.toThrow("already been consumed");
    });
  });

  describe("result()", () => {
    it("accumulates text into a UIMessage with text parts", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "Hello" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: " world" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const msg: UIMessage = await createChatStream(api, "test").result();

      expect(msg.role).toBe("assistant");
      expect(msg.parts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "text", text: "Hello world" })]),
      );
    });

    it("accumulates reasoning into a UIMessage with reasoning parts", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "reasoning-start", id: "r1" }),
        JSON.stringify({ type: "reasoning-delta", id: "r1", delta: "Let me " }),
        JSON.stringify({ type: "reasoning-delta", id: "r1", delta: "think..." }),
        JSON.stringify({ type: "reasoning-end", id: "r1" }),
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "answer" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const msg: UIMessage = await createChatStream(api, "test").result();

      const reasoningPart = msg.parts.find((p) => p.type === "reasoning");
      expect(reasoningPart).toBeDefined();
      expect(reasoningPart!.type === "reasoning" && reasoningPart!.text).toBe("Let me think...");

      const textPart = msg.parts.find((p) => p.type === "text");
      expect(textPart).toBeDefined();
      expect(textPart!.type === "text" && textPart!.text).toBe("answer");
    });

    it("accumulates tool calls into dynamic-tool parts", async () => {
      const response = mockSseResponse([
        JSON.stringify({
          type: "tool-input-available",
          toolCallId: "tc1",
          toolName: "search",
          input: { q: "test" },
          dynamic: true,
        }),
        JSON.stringify({
          type: "tool-output-available",
          toolCallId: "tc1",
          output: "found it",
          dynamic: true,
        }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const msg: UIMessage = await createChatStream(api, "test").result();

      const toolPart = msg.parts.find((p) => p.type === "dynamic-tool");
      expect(toolPart).toBeDefined();
      if (toolPart?.type === "dynamic-tool") {
        expect(toolPart.toolName).toBe("search");
        expect(toolPart.toolCallId).toBe("tc1");
      }
    });

    it("throws ChatStreamError on error events", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "partial" }),
        JSON.stringify({ type: "error", errorText: "rate limited" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      await expect(createChatStream(api, "test").result()).rejects.toThrow(ChatStreamError);
      // Verify the error message
      try {
        const response2 = mockSseResponse([
          JSON.stringify({ type: "error", errorText: "rate limited" }),
          "[DONE]",
        ]);
        const api2 = createMockApiClient(response2);
        await createChatStream(api2, "test").result();
      } catch (e) {
        expect(e).toBeInstanceOf(ChatStreamError);
        expect((e as ChatStreamError).message).toBe("rate limited");
      }
    });

    it("throws ChatStreamError with fallback message when errorText is missing", async () => {
      const response = mockSseResponse([JSON.stringify({ type: "error" }), "[DONE]"]);
      const api = createMockApiClient(response);

      await expect(createChatStream(api, "test").result()).rejects.toThrow("Unknown stream error");
    });

    it("returns empty UIMessage for empty stream", async () => {
      const response = mockSseResponse(["[DONE]"]);
      const api = createMockApiClient(response);

      const msg: UIMessage = await createChatStream(api, "test").result();

      expect(msg.role).toBe("assistant");
      expect(msg.parts).toEqual([]);
    });

    it("prevents calling result() after iteration", async () => {
      const response = mockSseResponse([
        JSON.stringify({ type: "text-delta", id: "t1", delta: "Hello" }),
        "[DONE]",
      ]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "test");

      // Consume via iteration
      for await (const _e of stream) {
        /* drain */
      }

      // result() should fail since stream was consumed by iteration
      await expect(stream.result()).rejects.toThrow("already been consumed");
    });
  });

  describe("API client integration", () => {
    it("passes message, sessionId, and chat scope to rawPost", async () => {
      const response = mockSseResponse(["[DONE]"]);
      const api = createMockApiClient(response);

      const stream = createChatStream(api, "hello", { sessionId: "sess-1" });
      await stream.result();

      expect(api.rawPost).toHaveBeenCalledWith(
        "/api/v1/chat",
        { message: "hello", sessionId: "sess-1" },
        undefined,
        "chat",
      );
    });

    it("passes abort signal", async () => {
      const response = mockSseResponse(["[DONE]"]);
      const api = createMockApiClient(response);
      const controller = new AbortController();

      const stream = createChatStream(api, "hello", { signal: controller.signal });
      await stream.result();

      expect(api.rawPost).toHaveBeenCalledWith(
        "/api/v1/chat",
        expect.any(Object),
        controller.signal,
        "chat",
      );
    });

    it("lazily initiates the HTTP request", () => {
      const response = mockSseResponse(["[DONE]"]);
      const api = createMockApiClient(response);

      // Creating the stream should NOT trigger rawPost
      createChatStream(api, "test");
      expect(api.rawPost).not.toHaveBeenCalled();
    });
  });
});
