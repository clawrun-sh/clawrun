import { describe, it, expect } from "vitest";
import type { UIMessageStreamWriter } from "ai";
import { extractToolCalls, StreamingTagParser } from "./messaging.js";

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
// StreamingTagParser
// ---------------------------------------------------------------------------
describe("StreamingTagParser", () => {
  it("emits text-start + text-delta for plain text", () => {
    const w = createMockWriter();
    const p = new StreamingTagParser(w as unknown as UIMessageStreamWriter);
    p.feed("hello world");
    p.flush();

    expect(w.events.some((e: StreamEvent) => e.type === "text-start")).toBe(true);
    expect(
      w.events.some((e: StreamEvent) => e.type === "text-delta" && e.delta === "hello world"),
    ).toBe(true);
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
