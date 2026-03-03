import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockWsInstance: MockWebSocket;

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 1; // OPEN
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3; // CLOSED
  }
}

vi.mock("ws", () => {
  return {
    default: class WS extends EventEmitter {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 1;
      sent: string[] = [];

      constructor(_url: string) {
        super();
        mockWsInstance = this as unknown as MockWebSocket;
        // Simulate async open
        setTimeout(() => this.emit("open"), 0);
      }

      send(data: string) {
        this.sent.push(data);
      }
      close() {
        this.readyState = 3;
      }
    },
  };
});

vi.mock("zeroclaw", () => ({
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

// Track StreamingTagParser instances — need to track multiple since clear
// creates a fresh parser. We track the latest one.
let parserInstances: Array<{
  feed: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  hasEmitted: boolean;
}>;

vi.mock("./messaging.js", () => ({
  StreamingTagParser: vi.fn().mockImplementation((writer: { write: (e: unknown) => void }) => {
    const instance = {
      feed: vi.fn((content: string) => {
        // Simulate emitting content to the writer (like the real parser)
        if (content && writer.write !== undefined) {
          instance.hasEmitted = true;
          // Only write if the writer is a real writer (not null)
          try {
            const id = `parser-${parserInstances.length}`;
            writer.write({ type: "text-start", id });
            writer.write({ type: "text-delta", id, delta: content });
          } catch {
            // null writer
          }
        }
      }),
      flush: vi.fn(() => {
        if (instance.hasEmitted) {
          try {
            writer.write({ type: "text-end", id: `parser-${parserInstances.length}` });
          } catch {
            // null writer
          }
        }
      }),
      hasEmitted: false,
    };
    parserInstances.push(instance);
    return instance;
  }),
  embedImages: vi.fn(async (_s: unknown, _r: string, text: string) => text),
  emitParsedResponse: vi.fn(),
  extractToolCalls: vi.fn((text: string) => ({ cleanText: text, toolCalls: [] })),
}));

import { fetchHistory, sendMessage, streamMessage, parseProgressLine } from "./ws-client.js";
import { StreamingTagParser } from "./messaging.js";
import { embedImages, emitParsedResponse, extractToolCalls } from "./messaging.js";

function mockSandbox() {
  return {
    domain: vi.fn((port: number) => `https://sbx.example.com:${port}`),
    readFile: vi.fn(async () => null),
    runCommand: vi.fn(),
    writeFiles: vi.fn(),
    stop: vi.fn(),
    snapshot: vi.fn(),
    extendTimeout: vi.fn(),
    updateNetworkPolicy: vi.fn(),
  };
}

function createMockWriter() {
  const events: unknown[] = [];
  return {
    write: vi.fn((event: unknown) => events.push(event)),
    events,
  };
}

/** Helper: send a JSON message from the "server" to the WS client */
function serverSend(msg: Record<string, unknown>) {
  mockWsInstance.emit("message", Buffer.from(JSON.stringify(msg)));
}

/** Get the latest StreamingTagParser instance */
function latestParser() {
  return parserInstances[parserInstances.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  parserInstances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// fetchHistory
// ---------------------------------------------------------------------------

describe("fetchHistory", () => {
  it("returns messages from history event", async () => {
    const sandbox = mockSandbox();
    const promise = fetchHistory(sandbox as any, "/root", "sess-1");

    await vi.advanceTimersByTimeAsync(10);

    serverSend({
      type: "history",
      session_id: "sess-1",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });

    const result = await promise;
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].content).toBe("hello");
  });

  it("returns empty on timeout", async () => {
    const sandbox = mockSandbox();
    const promise = fetchHistory(sandbox as any, "/root", "sess-1");

    await vi.advanceTimersByTimeAsync(11_000);

    const result = await promise;
    expect(result).toEqual([]);
  });

  it("returns empty on WS error", async () => {
    const sandbox = mockSandbox();
    const promise = fetchHistory(sandbox as any, "/root", "sess-1");

    await vi.advanceTimersByTimeAsync(10);
    mockWsInstance.emit("error", new Error("connection refused"));

    const result = await promise;
    expect(result).toEqual([]);
  });

  it("returns empty when aborted before connect", async () => {
    const sandbox = mockSandbox();
    const controller = new AbortController();
    controller.abort();

    const result = await fetchHistory(sandbox as any, "/root", "sess-1", {
      signal: controller.signal,
    });
    expect(result).toEqual([]);
  });

  it("builds correct WS URL with session_id", async () => {
    const sandbox = mockSandbox();
    fetchHistory(sandbox as any, "/root", "test-session");
    expect(sandbox.domain).toHaveBeenCalledWith(3000);
  });

});

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

describe("sendMessage", () => {
  it("sends message on open and resolves on done", async () => {
    const sandbox = mockSandbox();
    const promise = sendMessage(sandbox as any, "/root", "hello", { sessionId: "s1" });

    await vi.advanceTimersByTimeAsync(10);

    // Verify message was sent
    const sent = JSON.parse(mockWsInstance.sent[0]);
    expect(sent).toEqual({ type: "message", content: "hello" });

    serverSend({ type: "history", messages: [] });
    serverSend({ type: "done", full_response: "Hello back!" });

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.message).toBe("Hello back!");
  });

  it("accumulates chunks and uses them when full_response is absent", async () => {
    const sandbox = mockSandbox();
    const promise = sendMessage(sandbox as any, "/root", "hello");

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "chunk", content: "Hello " });
    serverSend({ type: "chunk", content: "world" });
    serverSend({ type: "done" }); // no full_response

    const result = await promise;
    expect(result.success).toBe(true);
    expect(extractToolCalls).toHaveBeenCalledWith("Hello world");
  });

  it("prefers full_response over accumulated chunks", async () => {
    const sandbox = mockSandbox();
    const promise = sendMessage(sandbox as any, "/root", "hello");

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "chunk", content: "partial" });
    serverSend({ type: "done", full_response: "Complete response" });

    const result = await promise;
    expect(extractToolCalls).toHaveBeenCalledWith("Complete response");
    expect(result.message).toBe("Complete response");
  });

  it("calls extractToolCalls on response text", async () => {
    const sandbox = mockSandbox();
    vi.mocked(extractToolCalls).mockReturnValueOnce({
      cleanText: "result",
      toolCalls: [{ name: "shell", arguments: { cmd: "ls" } }],
    });
    const promise = sendMessage(sandbox as any, "/root", "hello");

    await vi.advanceTimersByTimeAsync(10);
    serverSend({ type: "done", full_response: '<tool_call name="shell">ls</tool_call>result' });

    const result = await promise;
    expect(extractToolCalls).toHaveBeenCalled();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("shell");
  });

  it("calls embedImages on clean text", async () => {
    const sandbox = mockSandbox();
    vi.mocked(embedImages).mockResolvedValueOnce("enriched text with ![img](data:...)");
    const promise = sendMessage(sandbox as any, "/root", "hello");

    await vi.advanceTimersByTimeAsync(10);
    serverSend({ type: "done", full_response: "text with [IMAGE:/tmp/screenshot.png]" });

    const result = await promise;
    expect(embedImages).toHaveBeenCalled();
    expect(result.message).toBe("enriched text with ![img](data:...)");
  });

  it("resolves with error on error event", async () => {
    const sandbox = mockSandbox();
    const promise = sendMessage(sandbox as any, "/root", "hello");

    await vi.advanceTimersByTimeAsync(10);
    serverSend({ type: "error", message: "bad request" });

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("bad request");
  });

  it("rejects on abort", async () => {
    const sandbox = mockSandbox();
    const controller = new AbortController();
    controller.abort();

    await expect(
      sendMessage(sandbox as any, "/root", "hello", { signal: controller.signal }),
    ).rejects.toThrow("Aborted");
  });

  it("rejects on non-1000 close", async () => {
    const sandbox = mockSandbox();
    const promise = sendMessage(sandbox as any, "/root", "hello");

    await vi.advanceTimersByTimeAsync(10);
    mockWsInstance.emit("close", 1006);

    await expect(promise).rejects.toThrow("WebSocket closed with code 1006");
  });

  it("ignores status and tool_progress events", async () => {
    const sandbox = mockSandbox();
    const promise = sendMessage(sandbox as any, "/root", "hello");

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "status", content: "Thinking..." });
    serverSend({ type: "tool_progress", content: "Running shell..." });
    serverSend({ type: "done", full_response: "Done" });

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.message).toBe("Done");
  });
});

// ---------------------------------------------------------------------------
// streamMessage
// ---------------------------------------------------------------------------

describe("streamMessage", () => {
  it("creates initial parser with null writer (pre-clear)", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // First parser should be created with a null writer (not the real one)
    expect(StreamingTagParser).toHaveBeenCalledTimes(1);
    // The first argument should be the null writer (not the real writer)
    const firstCallWriter = vi.mocked(StreamingTagParser).mock.calls[0][0];
    expect(firstCallWriter).not.toBe(writer);

    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "answer" });
    await promise;
  });

  it("replaces parser with real writer on clear event", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // Initial parser (null writer)
    expect(parserInstances).toHaveLength(1);

    serverSend({ type: "clear" });

    // After clear, a second parser should be created with the real writer
    expect(parserInstances).toHaveLength(2);
    const secondCallWriter = vi.mocked(StreamingTagParser).mock.calls[1][0];
    expect(secondCallWriter).toBe(writer);

    serverSend({ type: "chunk", content: "Final answer" });
    serverSend({ type: "done", full_response: "Final answer" });
    await promise;
  });

  it("streams post-clear chunks through parser with real writer", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any, {
      sessionId: "s1",
    });

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "history", messages: [] });
    serverSend({ type: "clear" });
    serverSend({ type: "chunk", content: "Hello " });
    serverSend({ type: "chunk", content: "world" });
    serverSend({ type: "done", full_response: "Hello world" });

    await promise;

    // Post-clear parser should have been fed the chunks
    const postClearParser = parserInstances[1];
    expect(postClearParser.feed).toHaveBeenCalledWith("Hello ");
    expect(postClearParser.feed).toHaveBeenCalledWith("world");
    expect(postClearParser.feed).toHaveBeenCalledTimes(2);
  });

  it("discards pre-clear chunks (sent to null writer)", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // Pre-clear chunks go to null writer parser
    serverSend({ type: "chunk", content: "intermediate thinking..." });

    const preClearParser = parserInstances[0];
    expect(preClearParser.feed).toHaveBeenCalledWith("intermediate thinking...");
    // The null writer discards the output

    serverSend({ type: "clear" });
    serverSend({ type: "chunk", content: "Final answer" });
    serverSend({ type: "done", full_response: "Final answer" });

    await promise;

    // Real writer should NOT have received pre-clear content
    // Only post-clear content should appear
    const textStartEvents = writer.events.filter((e: any) => e.type === "text-start");
    // Should have exactly one text-start (from post-clear parser)
    expect(textStartEvents).toHaveLength(1);
  });

  it("flushes parser on done event", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "clear" });
    serverSend({ type: "chunk", content: "text" });
    serverSend({ type: "done", full_response: "text" });

    await promise;

    const postClearParser = parserInstances[1];
    expect(postClearParser.flush).toHaveBeenCalled();
  });

  it("calls embedImages on done when post-clear chunks were streamed", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "clear" });
    serverSend({ type: "chunk", content: "Answer" });
    serverSend({ type: "done", full_response: "Answer with [IMAGE:/tmp/img.png]" });

    await promise;

    // Post-clear parser hasEmitted is true (chunks were fed)
    expect(embedImages).toHaveBeenCalledWith(sandbox, "/root", "Answer with [IMAGE:/tmp/img.png]");
    // emitParsedResponse should NOT be called (content was streamed)
    expect(emitParsedResponse).not.toHaveBeenCalled();
  });

  it("falls back to emitParsedResponse when no clear received", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // No clear — go straight to done (edge case: daemon error/old version)
    serverSend({ type: "done", full_response: "Complete answer" });

    await promise;

    expect(emitParsedResponse).toHaveBeenCalledWith(writer, "Complete answer");
  });

  it("provides fallback text when full_response is empty and no clear", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "done", full_response: "" });

    await promise;

    expect(emitParsedResponse).toHaveBeenCalledWith(
      writer,
      "Tool execution completed, but no final response text was returned.",
    );
  });

  it("flushes old parser on clear event", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "chunk", content: "progress..." });

    const preClearParser = parserInstances[0];
    serverSend({ type: "clear" });

    // Pre-clear parser should have been flushed
    expect(preClearParser.flush).toHaveBeenCalled();

    serverSend({ type: "chunk", content: "Final answer" });
    serverSend({ type: "done", full_response: "Final answer" });

    await promise;
  });

  it("handles error events", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "error", message: "Server error" });

    await promise;

    const errorEvent = writer.events.find((e: any) => e.type === "error") as any;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.errorText).toBe("Server error");
  });

  it("rejects on abort", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const controller = new AbortController();
    controller.abort();

    await expect(
      streamMessage(sandbox as any, "/root", "hello", writer as any, {
        signal: controller.signal,
      }),
    ).rejects.toThrow("Aborted");
  });

  it("handles WS connection errors gracefully", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);
    mockWsInstance.emit("error", new Error("ECONNREFUSED"));

    await promise;

    const errorEvent = writer.events.find((e: any) => e.type === "error") as any;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.errorText).toBe("ECONNREFUSED");
  });

  it("rejects on non-1000 close code", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);
    mockWsInstance.emit("close", 1006);

    await expect(promise).rejects.toThrow("WebSocket closed with code 1006");
  });

  it("resolves on normal (1000) close code", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);
    mockWsInstance.emit("close", 1000);

    await promise; // should resolve, not reject
  });

  it("ignores empty chunk content", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "clear" });
    serverSend({ type: "chunk", content: "" });
    serverSend({ type: "chunk" }); // missing content
    serverSend({ type: "chunk", content: "real content" });
    serverSend({ type: "done", full_response: "real content" });

    await promise;

    const postClearParser = parserInstances[1];
    // Only "real content" should have been fed (empty strings filtered out)
    expect(postClearParser.feed).toHaveBeenCalledTimes(1);
    expect(postClearParser.feed).toHaveBeenCalledWith("real content");
  });

  it("ignores status events", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "status", content: "Thinking..." });
    serverSend({ type: "clear" });
    serverSend({ type: "chunk", content: "Answer" });
    serverSend({ type: "done", full_response: "Answer" });

    await promise;

    const statusEvents = writer.events.filter((e: any) => e.type === "status");
    expect(statusEvents).toHaveLength(0);
  });

  it("emits tool-input-available for new pending tools in tool_progress", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "tool_progress", content: "⏳ shell: pwd" });
    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "ok" });

    await promise;

    const toolInput = writer.events.find((e: any) => e.type === "tool-input-available") as any;
    expect(toolInput).toBeDefined();
    expect(toolInput.toolName).toBe("shell");
    expect(toolInput.input).toEqual({ args: "pwd" });
    expect(toolInput.dynamic).toBe(true);
  });

  it("emits tool-output-available when tool transitions to completed", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // First: pending
    serverSend({ type: "tool_progress", content: "⏳ shell: pwd" });
    // Second: completed
    serverSend({ type: "tool_progress", content: "✅ shell (2s)" });

    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "ok" });

    await promise;

    const toolOutput = writer.events.find((e: any) => e.type === "tool-output-available") as any;
    expect(toolOutput).toBeDefined();
    expect(toolOutput.output).toBe("completed");
    expect(toolOutput.dynamic).toBe(true);
  });

  it("emits tool-output-available with 'failed' for error tools", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "tool_progress", content: "⏳ shell: rm -rf" });
    serverSend({ type: "tool_progress", content: "❌ shell (1s)" });

    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "ok" });

    await promise;

    const toolOutput = writer.events.find((e: any) => e.type === "tool-output-available") as any;
    expect(toolOutput).toBeDefined();
    expect(toolOutput.output).toBe("failed");
  });

  it("tracks multiple tools across cumulative progress events", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // First tool appears
    serverSend({ type: "tool_progress", content: "⏳ shell: pwd" });
    // First tool completes, second appears
    serverSend({ type: "tool_progress", content: "✅ shell (1s)\n⏳ file_read: /tmp/a.txt" });
    // Both complete
    serverSend({ type: "tool_progress", content: "✅ shell (1s)\n✅ file_read (2s)" });

    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "ok" });

    await promise;

    const toolInputs = writer.events.filter((e: any) => e.type === "tool-input-available") as any[];
    const toolOutputs = writer.events.filter(
      (e: any) => e.type === "tool-output-available",
    ) as any[];

    expect(toolInputs).toHaveLength(2);
    expect(toolInputs[0].toolName).toBe("shell");
    expect(toolInputs[1].toolName).toBe("file_read");
    expect(toolInputs[1].input).toEqual({ args: "/tmp/a.txt" });

    expect(toolOutputs).toHaveLength(2);
    expect(toolOutputs[0].output).toBe("completed");
    expect(toolOutputs[1].output).toBe("completed");
  });

  it("does not re-emit for already-tracked tools", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({ type: "tool_progress", content: "⏳ shell: pwd" });
    // Same content again (same tool at same index)
    serverSend({ type: "tool_progress", content: "⏳ shell: pwd" });

    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "ok" });

    await promise;

    const toolInputs = writer.events.filter((e: any) => e.type === "tool-input-available");
    expect(toolInputs).toHaveLength(1); // Not duplicated
  });

  it("handles tool already completed on first appearance", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // Tool appears already completed (first progress event is already done)
    serverSend({ type: "tool_progress", content: "✅ shell (1s)" });

    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "ok" });

    await promise;

    const toolInputs = writer.events.filter((e: any) => e.type === "tool-input-available");
    const toolOutputs = writer.events.filter((e: any) => e.type === "tool-output-available");

    expect(toolInputs).toHaveLength(1);
    expect(toolOutputs).toHaveLength(1);
  });

  it("logs history message count", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    serverSend({
      type: "history",
      messages: [
        { role: "user", content: "prev" },
        { role: "assistant", content: "reply" },
      ],
    });
    serverSend({ type: "clear" });
    serverSend({ type: "done", full_response: "ok" });

    await promise;
    // No error means history was handled without issues
  });

  it("handles multiple tool iterations (only last answer streamed)", async () => {
    const sandbox = mockSandbox();
    const writer = createMockWriter();
    const promise = streamMessage(sandbox as any, "/root", "hello", writer as any);

    await vi.advanceTimersByTimeAsync(10);

    // Simulate tool iteration: status → tool_progress → status → clear → chunks → done
    serverSend({ type: "status", content: "Thinking..." });
    serverSend({ type: "status", content: "Got 1 tool call(s)" });
    serverSend({ type: "tool_progress", content: "⏳ shell: pwd" });
    serverSend({ type: "tool_progress", content: "✅ shell (1s)" });
    serverSend({ type: "status", content: "Thinking (round 2)..." });
    serverSend({ type: "clear" });
    serverSend({ type: "chunk", content: "Here is the pwd output: /home" });
    serverSend({ type: "done", full_response: "Here is the pwd output: /home" });

    await promise;

    // Only the post-clear chunk should have been fed to the real parser
    const postClearParser = parserInstances[1];
    expect(postClearParser.feed).toHaveBeenCalledWith("Here is the pwd output: /home");

    // emitParsedResponse should NOT have been called (streamed via clear path)
    expect(emitParsedResponse).not.toHaveBeenCalled();

    // Tool events should have been emitted
    const toolInputs = writer.events.filter((e: any) => e.type === "tool-input-available");
    const toolOutputs = writer.events.filter((e: any) => e.type === "tool-output-available");
    expect(toolInputs).toHaveLength(1);
    expect(toolOutputs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseProgressLine
// ---------------------------------------------------------------------------

describe("parseProgressLine", () => {
  it("parses pending tool with hint", () => {
    const result = parseProgressLine("⏳ shell: pwd");
    expect(result).toEqual({ name: "shell", hint: "pwd", completed: false });
  });

  it("parses pending tool without hint", () => {
    const result = parseProgressLine("⏳ screenshot");
    expect(result).toEqual({ name: "screenshot", hint: "", completed: false });
  });

  it("parses successful completion", () => {
    const result = parseProgressLine("✅ shell (2s)");
    expect(result).toEqual({ name: "shell", hint: "", completed: true, success: true });
  });

  it("parses failed completion", () => {
    const result = parseProgressLine("❌ shell (3s)");
    expect(result).toEqual({ name: "shell", hint: "", completed: true, success: false });
  });

  it("returns null for unrecognised lines", () => {
    expect(parseProgressLine("")).toBeNull();
    expect(parseProgressLine("some random text")).toBeNull();
    expect(parseProgressLine("Thinking...")).toBeNull();
  });

  it("trims whitespace from hint", () => {
    const result = parseProgressLine("⏳ file_read: /tmp/a.txt ");
    expect(result?.hint).toBe("/tmp/a.txt");
  });

  it("handles tool names with underscores", () => {
    const result = parseProgressLine("⏳ web_search: claude code");
    expect(result).toEqual({ name: "web_search", hint: "claude code", completed: false });
  });
});

