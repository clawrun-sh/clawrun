import { describe, it, expect } from "vitest";
import type { UIMessageStreamWriter } from "ai";
import {
  extractToolCalls,
  StreamingTagParser,
  buildDaemonWsUrl,
  parseProgressLine,
  parseMemoryKey,
  parseAssistantParts,
  splitTextForStreaming,
} from "./messaging.js";
import type { SandboxHandle } from "@clawrun/agent";

// Common event shape from the streaming parser
interface StreamEvent {
  type: string;
  delta?: string;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  output?: string;
  errorText?: string;
}

// ---------------------------------------------------------------------------
// Mock writer: records all .write() calls
// ---------------------------------------------------------------------------
function createMockWriter() {
  const events: StreamEvent[] = [];
  return {
    write: (event: StreamEvent) => events.push(event),
    events,
  };
}

// ---------------------------------------------------------------------------
// buildDaemonWsUrl
// ---------------------------------------------------------------------------
describe("buildDaemonWsUrl", () => {
  const makeSandbox = (url: string) => ({ domain: () => url }) as unknown as SandboxHandle;

  it("converts https to wss and appends path", () => {
    const result = buildDaemonWsUrl(makeSandbox("https://daemon.example.com"), "/ws/clawrun");
    expect(result).toBe("wss://daemon.example.com/ws/clawrun");
  });

  it("converts http to ws and appends path", () => {
    const result = buildDaemonWsUrl(makeSandbox("http://localhost:3000"), "/ws/chat");
    expect(result).toBe("ws://localhost:3000/ws/chat");
  });

  it("appends thread_id query param when provided", () => {
    const result = buildDaemonWsUrl(
      makeSandbox("https://d.example.com"),
      "/ws/clawrun",
      "sess-123",
    );
    expect(result).toBe("wss://d.example.com/ws/clawrun?thread_id=sess-123");
  });

  it("omits query param when threadId is undefined", () => {
    const result = buildDaemonWsUrl(makeSandbox("https://d.example.com"), "/ws/chat");
    expect(result).not.toContain("?");
  });

  it("encodes special characters in threadId", () => {
    const result = buildDaemonWsUrl(makeSandbox("https://d.example.com"), "/ws/clawrun", "a b&c=d");
    expect(result).toContain("thread_id=a%20b%26c%3Dd");
  });
});

// ---------------------------------------------------------------------------
// StreamingTagParser
// ---------------------------------------------------------------------------
describe("StreamingTagParser", () => {
  it("emits text-start + text-delta for plain text", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("hello world");
    p.flush();

    expect(w.events.some((e: StreamEvent) => e.type === "text-start")).toBe(true);
    // Text is split into word-sized deltas for progressive streaming
    const textDeltas = w.events
      .filter((e: StreamEvent) => e.type === "text-delta")
      .map((e: StreamEvent) => e.delta)
      .join("");
    expect(textDeltas).toBe("hello world");
  });

  it("emits reasoning-start + reasoning-delta for <thinking> tags", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("<thinking>deep thought</thinking>");
    p.flush();

    expect(w.events.some((e: StreamEvent) => e.type === "reasoning-start")).toBe(true);
    expect(
      w.events.some((e: StreamEvent) => e.type === "reasoning-delta" && e.delta === "deep thought"),
    ).toBe(true);
  });

  it("closes reasoning on </thinking>", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("<thinking>thought</thinking>");
    p.flush();

    expect(w.events.some((e: StreamEvent) => e.type === "reasoning-end")).toBe(true);
  });

  it("unwraps <response> tags as plain text", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("<response>inner content</response>");
    p.flush();

    const deltas = w.events.filter((e: StreamEvent) => e.type === "text-delta");
    const combined = deltas.map((e: StreamEvent) => e.delta).join("");
    expect(combined).toBe("inner content");
  });

  it("emits tool-input-available for <tool_call>", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed('<tool_call name="shell">{"cmd":"ls"}</tool_call>');
    p.flush();

    const tc = w.events.find((e: StreamEvent) => e.type === "tool-input-available");
    expect(tc).toBeDefined();
    expect(tc!.toolName).toBe("shell");
  });

  it("parses JSON args from tool_call body", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed('<tool_call name="shell">{"cmd":"ls","flag":"-la"}</tool_call>');
    p.flush();

    const tc = w.events.find((e: StreamEvent) => e.type === "tool-input-available");
    expect(tc!.input).toEqual({ cmd: "ls", flag: "-la" });
  });

  it("handles malformed JSON in tool_call gracefully", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed('<tool_call name="shell">not json</tool_call>');
    p.flush();

    const tc = w.events.find((e: StreamEvent) => e.type === "tool-input-available");
    expect(tc).toBeDefined();
    expect(tc!.input).toEqual({});
  });

  it("emits tool-output-available for <tool_result>", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    // Need a tool_call first to set currentToolCallId
    p.feed('<tool_call name="shell">{"cmd":"ls"}</tool_call>');
    p.feed("<tool_result>file1.txt\nfile2.txt</tool_result>");
    p.flush();

    const tr = w.events.find((e: StreamEvent) => e.type === "tool-output-available");
    expect(tr).toBeDefined();
    expect(tr!.output).toBe("file1.txt\nfile2.txt");
  });

  it("buffers partial tags across chunks", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("<thi");
    p.feed("nking>thought</thinking>");
    p.flush();

    expect(w.events.some((e: StreamEvent) => e.type === "reasoning-start")).toBe(true);
    expect(
      w.events.some((e: StreamEvent) => e.type === "reasoning-delta" && e.delta === "thought"),
    ).toBe(true);
  });

  it("emits buffered text when partial tag exceeds MAX_TAG_BUFFER", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    // '<' + 513 chars — exceeds MAX_TAG_BUFFER (512), should emit as text
    const longStr = "<" + "x".repeat(513);
    p.feed(longStr);
    p.flush();

    const deltas = w.events.filter((e: StreamEvent) => e.type === "text-delta");
    const combined = deltas.map((e: StreamEvent) => e.delta).join("");
    expect(combined).toContain("<");
  });

  it("flush closes open text part", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("hello");
    p.flush();

    expect(w.events.some((e: StreamEvent) => e.type === "text-end")).toBe(true);
  });

  it("flush closes open reasoning part", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("<thinking>still thinking");
    p.flush();

    expect(w.events.some((e: StreamEvent) => e.type === "reasoning-end")).toBe(true);
  });

  it("handles mixed content: text → thinking → text", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("before <thinking>thought</thinking> after");
    p.flush();

    const types = w.events.map((e: StreamEvent) => e.type);
    // text-start → text-delta("before ") → text-end → reasoning-start → ...
    expect(types).toContain("text-delta");
    expect(types).toContain("reasoning-start");
    expect(types).toContain("reasoning-end");
  });

  it("ignores stray </thinking> without opener", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    // Should not throw, just consume the stray tag
    p.feed("hello</thinking>world");
    p.flush();

    // The text around the stray tag should still be emitted
    const deltas = w.events.filter((e: StreamEvent) => e.type === "text-delta");
    const combined = deltas.map((e: StreamEvent) => e.delta).join("");
    expect(combined).toContain("hello");
    expect(combined).toContain("world");
  });

  it("hasEmitted is false before any feed", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    expect(p.hasEmitted).toBe(false);
  });

  it("hasEmitted is true after text feed", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("hello");
    expect(p.hasEmitted).toBe(true);
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
    const result = parseProgressLine("⏳ shell");
    expect(result).toEqual({ name: "shell", hint: "", completed: false });
  });

  it("parses successful completion", () => {
    const result = parseProgressLine("✅ shell (2s)");
    expect(result).toEqual({ name: "shell", hint: "", completed: true, success: true });
  });

  it("parses failed completion", () => {
    const result = parseProgressLine("❌ shell (2s)");
    expect(result).toEqual({ name: "shell", hint: "", completed: true, success: false });
  });

  it("returns null for unrecognised line", () => {
    expect(parseProgressLine("some random text")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseProgressLine("")).toBeNull();
  });

  it("handles underscored tool names", () => {
    const result = parseProgressLine("⏳ web_search: query");
    expect(result).toEqual({ name: "web_search", hint: "query", completed: false });
  });

  it("handles underscored tool names in completion", () => {
    const result = parseProgressLine("✅ web_search (5s)");
    expect(result).toEqual({ name: "web_search", hint: "", completed: true, success: true });
  });
});

// ---------------------------------------------------------------------------
// extractToolCalls
// ---------------------------------------------------------------------------
describe("extractToolCalls", () => {
  it("extracts tool_call with name attribute", () => {
    const input = '<tool_call name="shell">{"cmd":"ls"}</tool_call>';
    const { toolCalls } = extractToolCalls(input);
    expect(toolCalls[0].name).toBe("shell");
  });

  it("extracts tool_call with type attribute", () => {
    const input = '<tool_call type="web_search">{"query":"test"}</tool_call>';
    const { toolCalls } = extractToolCalls(input);
    expect(toolCalls[0].name).toBe("web_search");
  });

  it("strips <thinking> blocks from cleanText", () => {
    const input = "before <thinking>hidden</thinking> after";
    const { cleanText } = extractToolCalls(input);
    expect(cleanText).not.toContain("<thinking>");
    expect(cleanText).not.toContain("hidden");
  });

  it("strips <response> wrappers, keeps content", () => {
    const input = "<response>visible text</response>";
    const { cleanText } = extractToolCalls(input);
    expect(cleanText).toContain("visible text");
    expect(cleanText).not.toContain("<response>");
  });

  it("strips <tool_result> blocks", () => {
    const input = 'before <tool_result name="shell">output</tool_result> after';
    const { cleanText } = extractToolCalls(input);
    expect(cleanText).not.toContain("<tool_result>");
    expect(cleanText).not.toContain("output");
  });

  it("handles multiple tool calls", () => {
    const input =
      '<tool_call name="shell">{"cmd":"ls"}</tool_call> ' +
      '<tool_call name="read">{"path":"."}</tool_call>';
    const { toolCalls } = extractToolCalls(input);
    expect(toolCalls.length).toBe(2);
  });

  it("handles malformed JSON gracefully", () => {
    // Body must contain {...} to match regex, but contents are invalid JSON
    const input = '<tool_call name="shell">{not: valid}</tool_call>';
    const { toolCalls, cleanText } = extractToolCalls(input);
    expect(toolCalls.length).toBe(0);
    expect(cleanText).not.toContain("<tool_call");
  });

  it("collapses triple+ newlines to double", () => {
    const input = "line1\n\n\n\nline2";
    const { cleanText } = extractToolCalls(input);
    expect(cleanText).not.toMatch(/\n{3,}/);
  });
});

// ---------------------------------------------------------------------------
// parseMemoryKey
// ---------------------------------------------------------------------------
describe("parseMemoryKey", () => {
  it("parses a clawrun user message key", () => {
    const result = parseMemoryKey("clawrun_my-thread_a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result).toEqual({
      role: "user",
      channel: "ClawRun",
      threadId: "clawrun_my-thread",
    });
  });

  it("parses a clawrun assistant response key", () => {
    const result = parseMemoryKey(
      "assistant_resp_clawrun_my-thread_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    expect(result).toEqual({
      role: "assistant",
      channel: "ClawRun",
      threadId: "clawrun_my-thread",
    });
  });

  it("handles clawrun thread IDs with underscores", () => {
    const result = parseMemoryKey("clawrun_my_thread_name_a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result).toEqual({
      role: "user",
      channel: "ClawRun",
      threadId: "clawrun_my_thread_name",
    });
  });

  it("parses a telegram user message key", () => {
    const result = parseMemoryKey("telegram_johndoe_12345");
    expect(result).toEqual({
      role: "user",
      channel: "Telegram",
      threadId: "telegram_johndoe",
    });
  });

  it("parses a telegram assistant response key", () => {
    const result = parseMemoryKey("assistant_resp_telegram_johndoe_12345");
    expect(result).toEqual({
      role: "assistant",
      channel: "Telegram",
      threadId: "telegram_johndoe",
    });
  });

  it("parses discord keys", () => {
    const result = parseMemoryKey("discord_user123_98765");
    expect(result).toEqual({
      role: "user",
      channel: "Discord",
      threadId: "discord_user123",
    });
  });

  it("parses slack keys with thread_ts", () => {
    // slack_sender_msgId_threadTs → strips last segment
    const result = parseMemoryKey("slack_john_12345_ts999");
    expect(result).toEqual({
      role: "user",
      channel: "Slack",
      threadId: "slack_john_12345",
    });
  });

  it("returns null for unknown channel", () => {
    expect(parseMemoryKey("unknown_foo_bar")).toBeNull();
  });

  it("returns null for keys without underscores", () => {
    expect(parseMemoryKey("nounderscore")).toBeNull();
  });

  it("returns null for empty rest after channel", () => {
    expect(parseMemoryKey("clawrun_")).toBeNull();
  });

  it("falls back to full rest when no UUID suffix in clawrun key", () => {
    const result = parseMemoryKey("clawrun_simpleid");
    expect(result).toEqual({
      role: "user",
      channel: "ClawRun",
      threadId: "clawrun_simpleid",
    });
  });
});

// ---------------------------------------------------------------------------
// parseAssistantParts
// ---------------------------------------------------------------------------
describe("parseAssistantParts", () => {
  it("returns plain text for content without XML tags", () => {
    const parts = parseAssistantParts("Hello world");
    expect(parts).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("parses <thinking> into reasoning part", () => {
    const parts = parseAssistantParts("<thinking>Let me think</thinking>Done.");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "reasoning", text: "Let me think" });
    expect(parts[1]).toEqual({ type: "text", text: "Done." });
  });

  it("parses <response> wrapper, keeping inner text", () => {
    const parts = parseAssistantParts("<response>The answer is 42.</response>");
    expect(parts).toEqual([{ type: "text", text: "The answer is 42." }]);
  });

  it("parses <tool_call> into dynamic-tool part", () => {
    const parts = parseAssistantParts('<tool_call name="shell">{"cmd":"ls"}</tool_call>');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "dynamic-tool",
      toolName: "shell",
      state: "output-available",
      input: { cmd: "ls" },
      output: "completed",
    });
  });

  it("consumes tool_result following tool_call", () => {
    const parts = parseAssistantParts(
      '<tool_call name="shell">{"cmd":"pwd"}</tool_call>' +
        '<tool_result name="shell">/home</tool_result>',
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "dynamic-tool",
      toolName: "shell",
      output: "/home",
    });
  });

  it("handles mixed content with all tag types", () => {
    const content =
      "<thinking>Analyzing</thinking>" +
      "Prefix " +
      '<tool_call name="read">{"path":"."}</tool_call>' +
      "<response>Final answer</response>";
    const parts = parseAssistantParts(content);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toEqual({ type: "reasoning", text: "Analyzing" });
    expect(parts[1]).toMatchObject({ type: "text", text: "Prefix" });
    expect(parts[2]).toMatchObject({ type: "dynamic-tool", toolName: "read" });
    expect(parts[3]).toEqual({ type: "text", text: "Final answer" });
  });

  it("handles malformed tool_call JSON gracefully", () => {
    const parts = parseAssistantParts('<tool_call name="shell">{invalid}</tool_call>');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "dynamic-tool",
      input: {},
    });
  });

  it("treats stray closing tags as plain text when no opening tags present", () => {
    // No opening tags → fast path returns content as-is
    const parts = parseAssistantParts('Some text</thinking></response><tool_result name="x" />');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "text" });
  });

  it("handles unclosed thinking tag", () => {
    const parts = parseAssistantParts("<thinking>no close tag");
    // Should not crash; returns fallback
    expect(parts.length).toBeGreaterThan(0);
  });

  it("handles type attribute variant in tool_call", () => {
    const parts = parseAssistantParts(
      '<tool_call type="web_fetch">{"url":"https://example.com"}</tool_call>',
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "dynamic-tool",
      toolName: "web_fetch",
    });
  });
});

// ---------------------------------------------------------------------------
// splitTextForStreaming
// ---------------------------------------------------------------------------
describe("splitTextForStreaming", () => {
  it("returns short text (<=8 chars) as a single chunk", () => {
    expect(splitTextForStreaming("hello")).toEqual(["hello"]);
    expect(splitTextForStreaming("hi there")).toEqual(["hi there"]);
  });

  it("splits multi-word text into word-sized chunks", () => {
    const chunks = splitTextForStreaming("hello world foo bar");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe("hello world foo bar");
  });

  it("preserves trailing whitespace on each word", () => {
    const chunks = splitTextForStreaming("The quick brown fox");
    // Each chunk except possibly last should include its trailing space
    expect(chunks[0]).toBe("The ");
    expect(chunks[1]).toBe("quick ");
    expect(chunks[2]).toBe("brown ");
    expect(chunks[3]).toBe("fox");
  });

  it("handles leading whitespace", () => {
    const chunks = splitTextForStreaming("  hello world");
    expect(chunks.join("")).toBe("  hello world");
  });

  it("handles multiple spaces between words", () => {
    const chunks = splitTextForStreaming("hello   world  test");
    expect(chunks.join("")).toBe("hello   world  test");
  });

  it("handles newlines as whitespace", () => {
    const chunks = splitTextForStreaming("line one\nline two\nline three");
    expect(chunks.join("")).toBe("line one\nline two\nline three");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("handles empty string", () => {
    expect(splitTextForStreaming("")).toEqual([""]);
  });

  it("returns single chunk for a single long word", () => {
    const longWord = "superlongword";
    const chunks = splitTextForStreaming(longWord);
    expect(chunks).toEqual([longWord]);
  });

  it("handles text with punctuation", () => {
    const chunks = splitTextForStreaming("Hello, world! How are you?");
    expect(chunks.join("")).toBe("Hello, world! How are you?");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("handles markdown-like content", () => {
    const text = "Here is a **bold** word and `code` block.";
    const chunks = splitTextForStreaming(text);
    expect(chunks.join("")).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// StreamingTagParser — word-level delta streaming
// ---------------------------------------------------------------------------
describe("StreamingTagParser word-level deltas", () => {
  it("splits long text into multiple text-delta events", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("The quick brown fox jumps over the lazy dog");
    p.flush();

    const deltas = w.events.filter((e: StreamEvent) => e.type === "text-delta");
    // Should have multiple word-level deltas, not a single blob
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e: StreamEvent) => e.delta).join("")).toBe(
      "The quick brown fox jumps over the lazy dog",
    );
  });

  it("keeps short text as a single delta", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("Hi");
    p.flush();

    const deltas = w.events.filter((e: StreamEvent) => e.type === "text-delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta).toBe("Hi");
  });

  it("all deltas share the same text ID", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("word one word two word three word four");
    p.flush();

    const deltas = w.events.filter((e: StreamEvent) => e.type === "text-delta");
    const ids = new Set(deltas.map((e: StreamEvent) => e.id));
    expect(ids.size).toBe(1);
  });

  it("emits text-start before first delta and text-end after flush", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("Hello world from agent");
    p.flush();

    const types = w.events.map((e: StreamEvent) => e.type);
    const startIdx = types.indexOf("text-start");
    const firstDeltaIdx = types.indexOf("text-delta");
    const endIdx = types.indexOf("text-end");

    expect(startIdx).toBeLessThan(firstDeltaIdx);
    expect(firstDeltaIdx).toBeLessThan(endIdx);
  });

  it("preserves exact content across multiple feed calls", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    // Simulate multiple WS chunks arriving
    p.feed("First chunk of text ");
    p.feed("and the second chunk ");
    p.feed("followed by the third.");
    p.flush();

    const deltas = w.events.filter((e: StreamEvent) => e.type === "text-delta");
    const combined = deltas.map((e: StreamEvent) => e.delta).join("");
    expect(combined).toBe("First chunk of text and the second chunk followed by the third.");
  });

  it("does not split reasoning content into word deltas", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("<thinking>This is a longer reasoning block with many words</thinking>");
    p.flush();

    // Reasoning content is emitted as-is (not word-split)
    const reasoningDeltas = w.events.filter((e: StreamEvent) => e.type === "reasoning-delta");
    expect(reasoningDeltas).toHaveLength(1);
    expect(reasoningDeltas[0].delta).toBe("This is a longer reasoning block with many words");
  });
});
