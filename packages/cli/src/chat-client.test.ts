import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendChatMessage } from "./chat-client.js";

/**
 * Build a fake Response whose body is a ReadableStream of SSE-formatted events.
 */
function makeSseResponse(events: Array<{ data: string }>): Response {
  const text = events.map((e) => `data: ${e.data}\n\n`).join("");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("sendChatMessage", () => {
  it("accumulates text-delta events into fullText", async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { data: JSON.stringify({ type: "text-delta", delta: "Hello " }) },
        { data: JSON.stringify({ type: "text-delta", delta: "world" }) },
        { data: "[DONE]" },
      ]),
    );

    const result = await sendChatMessage("http://localhost", "jwt", "hi");
    expect(result.success).toBe(true);
    expect(result.text).toBe("Hello world");
  });

  it("captures tool-input-available as toolCalls", async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        {
          data: JSON.stringify({
            type: "tool-input-available",
            toolName: "shell",
            input: { cmd: "ls" },
          }),
        },
        { data: "[DONE]" },
      ]),
    );

    const result = await sendChatMessage("http://localhost", "jwt", "run ls");
    expect(result.toolCalls[0].name).toBe("shell");
  });

  it("attaches tool-output to matching tool call", async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        {
          data: JSON.stringify({
            type: "tool-input-available",
            toolName: "shell",
            input: {},
          }),
        },
        {
          data: JSON.stringify({
            type: "tool-output-available",
            output: "file1.txt",
          }),
        },
        { data: "[DONE]" },
      ]),
    );

    const result = await sendChatMessage("http://localhost", "jwt", "msg");
    expect(result.toolCalls[0].output).toBe("file1.txt");
  });

  it("handles error event", async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { data: JSON.stringify({ type: "error", errorText: "sandbox down" }) },
        { data: "[DONE]" },
      ]),
    );

    const result = await sendChatMessage("http://localhost", "jwt", "msg");
    expect(result.success).toBe(false);
    expect(result.error).toBe("sandbox down");
  });

  it("terminates on [DONE] sentinel", async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { data: JSON.stringify({ type: "text-delta", delta: "a" }) },
        { data: "[DONE]" },
        // This event should never be processed
        { data: JSON.stringify({ type: "text-delta", delta: "SHOULD NOT APPEAR" }) },
      ]),
    );

    const result = await sendChatMessage("http://localhost", "jwt", "msg");
    expect(result.text).toBe("a");
  });

  it("calls onEvent callback for each event", async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { data: JSON.stringify({ type: "text-delta", delta: "a" }) },
        { data: JSON.stringify({ type: "text-delta", delta: "b" }) },
        { data: "[DONE]" },
      ]),
    );

    const onEvent = vi.fn();
    await sendChatMessage("http://localhost", "jwt", "msg", undefined, undefined, onEvent);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("skips malformed JSON events", async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { data: "not-json" },
        { data: JSON.stringify({ type: "text-delta", delta: "ok" }) },
        { data: "[DONE]" },
      ]),
    );

    const result = await sendChatMessage("http://localhost", "jwt", "msg");
    expect(result.success).toBe(true);
    expect(result.text).toBe("ok");
  });
});
