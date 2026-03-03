import { parseOutput, buildAgentCommand, DAEMON_PORT } from "zeroclaw";
import WebSocket from "ws";
import type { SandboxHandle, AgentResponse, ToolCallInfo } from "@clawrun/agent";
import type { UIMessageStreamWriter } from "ai";
import { createLogger } from "@clawrun/logger";

const log = createLogger("zeroclaw:ws");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract `<tool_call>` XML blocks from agent output, returning the cleaned
 * text and structured tool call info.
 *
 * Handles multiple attribute variants emitted by different ZeroClaw versions:
 *   - `<tool_call name="...">JSON</tool_call>`   (current stable)
 *   - `<tool_call type="...">JSON</tool_call>`   (newer builds)
 *
 * Also strips `<tool_result ... />` self-closing tags,
 * `<tool_result ...>...</tool_result>` content-bearing tags,
 * `<thinking>...</thinking>` blocks, and `<response>...</response>` wrappers
 * (keeping the inner content of `<response>`).
 */
export function extractToolCalls(text: string): {
  cleanText: string;
  toolCalls: ToolCallInfo[];
} {
  const toolCalls: ToolCallInfo[] = [];
  const CALL_RE = /<tool_call\s+(?:name|type)="([^"]+)">\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  const RESULT_SELF_RE = /<tool_result\s+[^>]*\/>/g;
  const RESULT_BLOCK_RE = /<tool_result\s+[^>]*>[\s\S]*?<\/tool_result>/g;
  const THINKING_RE = /<thinking>[\s\S]*?<\/thinking>/g;
  const RESPONSE_OPEN_RE = /<response>/g;
  const RESPONSE_CLOSE_RE = /<\/response>/g;

  const cleanText = text
    .replace(CALL_RE, (_, name, json) => {
      try {
        const parsed = JSON.parse(json);
        toolCalls.push({
          name,
          arguments: typeof parsed === "object" && parsed !== null ? parsed : {},
        });
      } catch {}
      return "";
    })
    .replace(RESULT_BLOCK_RE, "")
    .replace(RESULT_SELF_RE, "")
    .replace(THINKING_RE, "")
    .replace(RESPONSE_OPEN_RE, "")
    .replace(RESPONSE_CLOSE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanText, toolCalls };
}

// ---------------------------------------------------------------------------
// Streaming tag parser — processes ZeroClaw chunk text for XML tags and emits
// AI SDK UIMessageStream events (reasoning, text, tool input/output).
// ---------------------------------------------------------------------------

/** Known tag names the parser recognises. */
const KNOWN_TAGS = ["thinking", "response", "tool_call", "tool_result"] as const;

/** Maximum bytes we buffer while waiting for a potential tag to complete. */
const MAX_TAG_BUFFER = 512;

type ParserState = "normal" | "thinking" | "response" | "tool_call" | "tool_result";

/**
 * Tag-aware streaming parser for ZeroClaw output.
 *
 * Processes text chunks that may contain XML tags:
 *   `<thinking>` → AI SDK reasoning-start/delta/end
 *   `<response>` → AI SDK text-start/delta/end (unwraps tag)
 *   `<tool_call name="...">JSON</tool_call>` → tool-input-available
 *   `<tool_result ...>...</tool_result>` → tool-output-available
 *
 * Content outside tags is emitted as text-delta.
 */
export class StreamingTagParser {
  private buffer = "";
  private state: ParserState = "normal";
  private toolCallName = "";
  private toolCallBuffer = "";
  private toolResultBuffer = "";

  // AI SDK stream part state
  private textId = "";
  private textOpen = false;
  private reasoningId = "";
  private reasoningOpen = false;
  private currentToolCallId = "";
  private receivedAny = false;

  constructor(private writer: UIMessageStreamWriter) {}

  /** Whether any content was emitted. */
  get hasEmitted(): boolean {
    return this.receivedAny;
  }

  /** Feed a new chunk of text from the daemon. */
  feed(chunk: string): void {
    this.buffer += chunk;
    this.drain();
  }

  /** Flush remaining buffer and close any open parts. */
  flush(): void {
    // Emit anything left in the buffer
    if (this.buffer) {
      if (this.state === "thinking") {
        this.emitReasoning(this.buffer);
      } else if (this.state === "tool_call") {
        this.toolCallBuffer += this.buffer;
      } else if (this.state === "tool_result") {
        this.toolResultBuffer += this.buffer;
      } else {
        this.emitText(this.buffer);
      }
      this.buffer = "";
    }
    this.closeReasoning();
    this.closeText();
  }

  // -- Internal: drain buffer by consuming known patterns ------------------

  private drain(): void {
    let safety = 2000;
    while (this.buffer.length > 0 && --safety > 0) {
      if (!this.consumeNext()) break;
    }
  }

  private consumeNext(): boolean {
    switch (this.state) {
      case "thinking":
        return this.consumeInThinking();
      case "tool_call":
        return this.consumeInToolCall();
      case "tool_result":
        return this.consumeInToolResult();
      default:
        return this.consumeInNormal();
    }
  }

  /** Normal / response state: emit text, watch for tag openings. */
  private consumeInNormal(): boolean {
    const idx = this.buffer.indexOf("<");
    if (idx === -1) {
      this.emitText(this.buffer);
      this.buffer = "";
      return true;
    }

    // Emit text before the '<'
    if (idx > 0) {
      this.emitText(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx);
      return true;
    }

    // Buffer starts with '<' — try matching known tags

    // <thinking>
    if (this.buffer.startsWith("<thinking>")) {
      this.closeText();
      this.state = "thinking";
      this.buffer = this.buffer.slice("<thinking>".length);
      this.startReasoning();
      return true;
    }
    // </thinking> (stray close — ignore)
    if (this.buffer.startsWith("</thinking>")) {
      this.buffer = this.buffer.slice("</thinking>".length);
      return true;
    }

    // <response>
    if (this.buffer.startsWith("<response>")) {
      this.state = "response";
      this.buffer = this.buffer.slice("<response>".length);
      return true;
    }
    // </response>
    if (this.buffer.startsWith("</response>")) {
      this.state = "normal";
      this.buffer = this.buffer.slice("</response>".length);
      return true;
    }

    // <tool_call name="..." > or <tool_call type="...">
    const tcMatch = this.buffer.match(/^<tool_call\s+(?:name|type)="([^"]+)">/);
    if (tcMatch) {
      this.closeText();
      this.state = "tool_call";
      this.toolCallName = tcMatch[1];
      this.toolCallBuffer = "";
      this.buffer = this.buffer.slice(tcMatch[0].length);
      return true;
    }

    // <tool_result ... /> (self-closing)
    const trSelf = this.buffer.match(/^<tool_result\s+[^>]*\/>/);
    if (trSelf) {
      this.buffer = this.buffer.slice(trSelf[0].length);
      return true;
    }
    // <tool_result ...> (content-bearing)
    const trOpen = this.buffer.match(/^<tool_result[^>]*>/);
    if (trOpen) {
      this.state = "tool_result";
      this.toolResultBuffer = "";
      this.buffer = this.buffer.slice(trOpen[0].length);
      return true;
    }

    // Could this be a partial known tag? Keep buffering if short enough.
    if (this.isPotentialPartialTag() && this.buffer.length < MAX_TAG_BUFFER) {
      return false;
    }

    // Unknown '<' — emit as text
    this.emitText("<");
    this.buffer = this.buffer.slice(1);
    return true;
  }

  /** Inside <thinking>: emit reasoning-delta, watch for </thinking>. */
  private consumeInThinking(): boolean {
    const endIdx = this.buffer.indexOf("</thinking>");
    if (endIdx !== -1) {
      const text = this.buffer.slice(0, endIdx);
      if (text) this.emitReasoning(text);
      this.closeReasoning();
      this.state = "normal";
      this.buffer = this.buffer.slice(endIdx + "</thinking>".length);
      return true;
    }

    // Check for potential partial closing tag at end of buffer
    const partial = this.findPartialSuffix("</thinking>");
    if (partial >= 0 && this.buffer.length < MAX_TAG_BUFFER + partial) {
      const text = this.buffer.slice(0, partial);
      if (text) this.emitReasoning(text);
      this.buffer = this.buffer.slice(partial);
      return false; // Wait for more data
    }

    // No closing tag in sight — emit all as reasoning
    this.emitReasoning(this.buffer);
    this.buffer = "";
    return true;
  }

  /** Inside <tool_call>: buffer until </tool_call>. */
  private consumeInToolCall(): boolean {
    const endIdx = this.buffer.indexOf("</tool_call>");
    if (endIdx !== -1) {
      this.toolCallBuffer += this.buffer.slice(0, endIdx);
      this.emitToolCall();
      this.state = "normal";
      this.buffer = this.buffer.slice(endIdx + "</tool_call>".length);
      return true;
    }
    this.toolCallBuffer += this.buffer;
    this.buffer = "";
    return true;
  }

  /** Inside <tool_result>: buffer until </tool_result>. */
  private consumeInToolResult(): boolean {
    const endIdx = this.buffer.indexOf("</tool_result>");
    if (endIdx !== -1) {
      this.toolResultBuffer += this.buffer.slice(0, endIdx);
      this.emitToolResult();
      this.state = "normal";
      this.buffer = this.buffer.slice(endIdx + "</tool_result>".length);
      return true;
    }
    this.toolResultBuffer += this.buffer;
    this.buffer = "";
    return true;
  }

  // -- Partial tag detection -----------------------------------------------

  /** Check if buffer could be the start of a known tag. */
  private isPotentialPartialTag(): boolean {
    const candidates = [
      "<thinking>",
      "</thinking>",
      "<response>",
      "</response>",
      "<tool_call ",
      "<tool_result",
    ];
    for (const tag of candidates) {
      if (tag.startsWith(this.buffer) || this.buffer.startsWith(tag.slice(0, this.buffer.length))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the start of a potential partial closing tag at the end of the buffer.
   * Returns the index where the partial starts, or -1 if none found.
   */
  private findPartialSuffix(tag: string): number {
    for (let len = Math.min(tag.length - 1, this.buffer.length); len >= 1; len--) {
      if (this.buffer.endsWith(tag.slice(0, len))) {
        return this.buffer.length - len;
      }
    }
    return -1;
  }

  // -- Emit helpers --------------------------------------------------------

  private emitText(content: string): void {
    if (!content) return;
    this.receivedAny = true;
    if (!this.textOpen) {
      this.textId = crypto.randomUUID();
      this.writer.write({ type: "text-start", id: this.textId });
      this.textOpen = true;
    }
    this.writer.write({ type: "text-delta", id: this.textId, delta: content });
  }

  private closeText(): void {
    if (this.textOpen) {
      this.writer.write({ type: "text-end", id: this.textId });
      this.textOpen = false;
    }
  }

  private startReasoning(): void {
    this.reasoningId = crypto.randomUUID();
    this.writer.write({ type: "reasoning-start", id: this.reasoningId });
    this.reasoningOpen = true;
    this.receivedAny = true;
  }

  private emitReasoning(content: string): void {
    if (!content) return;
    if (!this.reasoningOpen) this.startReasoning();
    this.writer.write({ type: "reasoning-delta", id: this.reasoningId, delta: content });
  }

  private closeReasoning(): void {
    if (this.reasoningOpen) {
      this.writer.write({ type: "reasoning-end", id: this.reasoningId });
      this.reasoningOpen = false;
    }
  }

  private emitToolCall(): void {
    this.receivedAny = true;
    this.closeText();
    this.currentToolCallId = crypto.randomUUID();
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(this.toolCallBuffer.trim());
      if (typeof parsed === "object" && parsed !== null) args = parsed;
    } catch {}
    this.writer.write({
      type: "tool-input-available",
      toolCallId: this.currentToolCallId,
      toolName: this.toolCallName,
      input: args,
      dynamic: true,
    });
  }

  private emitToolResult(): void {
    this.receivedAny = true;
    this.writer.write({
      type: "tool-output-available",
      toolCallId: this.currentToolCallId,
      output: this.toolResultBuffer.trim() || "completed",
      dynamic: true,
    });
  }
}

/**
 * Parse a complete response text for tags and emit all appropriate AI SDK
 * stream events. Used for the done/message fallback when no chunks were
 * streamed.
 */
export function emitParsedResponse(writer: UIMessageStreamWriter, text: string): void {
  const parser = new StreamingTagParser(writer);
  parser.feed(text);
  parser.flush();
}

// --- Image embedding ---

const ATTACHMENT_RE = /!\[([^\]]*)\]\(attachment:([\w][\w.-]*)\)/g;
const IMAGE_MARKER_RE = /\[IMAGE:(\/[^\]]+)\]/g;
const BARE_IMAGE_RE = /\b([\w][\w.-]*\.(?:png|jpe?g|gif|webp|bmp))\b/gi;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function mimeFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] : undefined;
}

/**
 * Resolve attachment references in agent response text to inline data URIs.
 *
 * Handles three formats:
 *   1. `![alt](attachment:filename)` — markdown image with attachment: scheme
 *   2. `[IMAGE:/path/to/file]`       — ZeroClaw native marker
 *   3. bare filenames (e.g. hn.png)  — validated by reading from sandbox
 */
export async function embedImages(
  sandbox: SandboxHandle,
  root: string,
  text: string,
): Promise<string> {
  const agentDir = `${root}/agent`;

  // 1. Handle ![alt](attachment:filename)
  const attachmentMatches = [...text.matchAll(ATTACHMENT_RE)];
  for (const m of attachmentMatches) {
    const [fullMatch, alt, filename] = m;
    const mime = mimeFromPath(filename);
    if (!mime) continue;

    const buf = await sandbox.readFile(`${agentDir}/${filename}`);
    if (!buf) continue;

    const b64 = buf.toString("base64");
    text = text.replace(fullMatch, `![${alt}](data:${mime};base64,${b64})`);
  }

  // 2. Handle [IMAGE:/absolute/path]
  const markerMatches = [...text.matchAll(IMAGE_MARKER_RE)];
  for (const m of markerMatches) {
    const [fullMatch, filePath] = m;
    const mime = mimeFromPath(filePath);
    if (!mime) continue;

    const buf = await sandbox.readFile(filePath);
    if (!buf) continue;

    const b64 = buf.toString("base64");
    const alt = filePath.split("/").pop() ?? "image";
    text = text.replace(fullMatch, `![${alt}](data:${mime};base64,${b64})`);
  }

  // 3. Fallback: bare image filenames — validate by reading from sandbox
  const seen = new Set<string>();
  const bareMatches = [...text.matchAll(BARE_IMAGE_RE)];
  for (const m of bareMatches) {
    const filename = m[1];
    if (seen.has(filename)) continue;
    seen.add(filename);

    const mime = mimeFromPath(filename);
    if (!mime) continue;

    const buf =
      (await sandbox.readFile(`${agentDir}/${filename}`)) ??
      (await sandbox.readFile(`${agentDir}/workspace/${filename}`));
    if (!buf) continue;

    const b64 = buf.toString("base64");
    text = text.replace(
      new RegExp(
        `(?:[-*]\\s+|File:\\s*)?` + `\`?${escapeRegExp(filename)}\`?` + `(?:\\s*\\(attached\\))?`,
      ),
      `![${filename}](data:${mime};base64,${b64})`,
    );
  }

  return text;
}

// --- Fetch history via daemon WebSocket ---

export async function fetchHistoryViaDaemon(
  sandbox: SandboxHandle,
  root: string,
  sessionId: string,
  opts?: { signal?: AbortSignal },
): Promise<Array<{ role: string; content: string }>> {
  const daemonUrl = sandbox.domain!(DAEMON_PORT);
  let wsUrl = daemonUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/chat";
  wsUrl += `?session_id=${encodeURIComponent(sessionId)}`;
  log.info(`fetchHistory url=${wsUrl} sessionId=${sessionId}`);

  return new Promise<Array<{ role: string; content: string }>>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve([]);
    }, 10_000);

    const ws = new WebSocket(wsUrl);
    const signal = opts?.signal;

    const cleanup = () => {
      clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        resolve([]);
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          resolve([]);
        },
        { once: true },
      );
    }

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          type?: string;
          messages?: Array<{ role: string; content: string }>;
        };
        if (msg.type === "history") {
          const messages = Array.isArray(msg.messages) ? msg.messages : [];
          log.info(`fetchHistory received ${messages.length} messages`);
          cleanup();
          resolve(messages);
        }
      } catch {}
    });

    ws.on("error", () => {
      cleanup();
      resolve([]);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

// --- Send via CLI one-shot ---

export async function sendMessageViaCli(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  env: Record<string, string>,
  opts?: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    sessionId?: string;
  },
): Promise<AgentResponse> {
  const cmd = buildAgentCommand(`${root}/bin/zeroclaw`, message, env);
  const result = await sandbox.runCommand({
    cmd: cmd.cmd,
    args: cmd.args,
    env: { ...cmd.env, ...opts?.env },
    signal: opts?.signal,
  });
  const stdout = await result.stdout();
  const stderr = await result.stderr();
  const parsed = parseOutput(stdout, stderr, result.exitCode);
  const { cleanText, toolCalls } = extractToolCalls(parsed.message);

  const enriched = await embedImages(sandbox, root, cleanText);

  return {
    success: parsed.success,
    message: enriched,
    error: parsed.error,
    toolCalls,
  };
}

// --- Send via daemon WebSocket ---

export async function sendMessageViaDaemon(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  opts?: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    sessionId?: string;
  },
): Promise<AgentResponse> {
  const daemonUrl = sandbox.domain!(DAEMON_PORT);
  let wsUrl = daemonUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/chat";
  if (opts?.sessionId) {
    wsUrl += `?session_id=${encodeURIComponent(opts.sessionId)}`;
  }
  log.info(`url=${wsUrl} sessionId=${opts?.sessionId ?? "(none)"}`);

  const toolCalls: ToolCallInfo[] = [];

  return new Promise<AgentResponse>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const signal = opts?.signal;
    let settled = false;

    const cleanup = () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          settle(() => reject(new DOMException("Aborted", "AbortError")));
        },
        { once: true },
      );
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "message", content: message }));
    });

    let pendingContent = "";

    ws.on("message", (data: Buffer) => {
      let msg: {
        type?: "message" | "chunk" | "tool_call" | "tool_result" | "done" | "error" | "history";
        content?: string;
        full_response?: string;
        name?: string;
        args?: Record<string, unknown>;
        output?: string;
        message?: string;
      };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }

      switch (msg.type) {
        case "history": {
          const count = Array.isArray((msg as { messages?: unknown }).messages)
            ? (msg as { messages: unknown[] }).messages.length
            : 0;
          log.info(`Session history: ${count} messages`);
          break;
        }
        case "chunk": {
          pendingContent += msg.content ?? "";
          break;
        }
        case "tool_call": {
          toolCalls.push({
            name: msg.name ?? "unknown",
            arguments: msg.args ?? {},
          });
          break;
        }
        case "tool_result": {
          if (toolCalls.length > 0) {
            toolCalls[toolCalls.length - 1].output = msg.output ?? "";
          }
          break;
        }
        case "message":
        case "done": {
          const raw = (msg.full_response ?? msg.content ?? pendingContent).trim();
          const finalContent =
            raw || "Tool execution completed, but no final response text was returned.";
          const { cleanText, toolCalls: extractedTools } = extractToolCalls(finalContent);
          const finalTools = toolCalls.length > 0 ? toolCalls : extractedTools;
          pendingContent = "";
          cleanup();
          embedImages(sandbox, root, cleanText).then(
            (enriched) =>
              settle(() =>
                resolve({
                  success: true,
                  message: enriched,
                  toolCalls: finalTools,
                }),
              ),
            (err) => settle(() => reject(err)),
          );
          break;
        }
        case "error": {
          pendingContent = "";
          cleanup();
          settle(() =>
            resolve({
              success: false,
              message: "",
              error: msg.message ?? "Unknown error",
            }),
          );
          break;
        }
      }
    });

    ws.on("error", (err: Error) => {
      cleanup();
      settle(() => reject(err));
    });

    ws.on("close", (code: number) => {
      if (code !== 1000) {
        settle(() => reject(new Error(`WebSocket closed with code ${code}`)));
      }
    });
  });
}

// --- Stream via daemon WebSocket → AI SDK UIMessageStream ---

/**
 * Adapter: connects to ZeroClaw daemon WS and writes AI SDK UIMessageStream
 * events directly to the writer. This is the streaming equivalent of
 * sendMessageViaDaemon — instead of returning a batch AgentResponse, it pipes
 * chunks, tool events, and completion directly to the client stream.
 *
 * Chunks are processed through StreamingTagParser which handles:
 *   - `<thinking>` → reasoning-start/delta/end
 *   - `<response>` → text (unwrapped)
 *   - `<tool_call>` → tool-input-available
 *   - `<tool_result>` → tool-output-available
 *
 * The daemon may also send structured `tool_call`/`tool_result` WS messages
 * which are handled alongside the XML tag parsing.
 */
export async function streamMessageViaDaemon(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  writer: UIMessageStreamWriter,
  opts?: { signal?: AbortSignal; sessionId?: string },
): Promise<void> {
  const daemonUrl = sandbox.domain!(DAEMON_PORT);
  let wsUrl = daemonUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/chat";
  if (opts?.sessionId) {
    wsUrl += `?session_id=${encodeURIComponent(opts.sessionId)}`;
  }
  log.info(`stream url=${wsUrl} sessionId=${opts?.sessionId ?? "(none)"}`);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const signal = opts?.signal;
    let settled = false;

    // Tag-aware parser for chunk content
    const parser = new StreamingTagParser(writer);

    // Track current tool call ID for structured WS tool messages
    let currentToolCallId = "";

    const cleanup = () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          parser.flush();
          cleanup();
          settle(() => reject(new DOMException("Aborted", "AbortError")));
        },
        { once: true },
      );
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "message", content: message }));
    });

    ws.on("message", (data: Buffer) => {
      let msg: {
        type?: "message" | "chunk" | "tool_call" | "tool_result" | "done" | "error" | "history";
        content?: string;
        full_response?: string;
        name?: string;
        args?: Record<string, unknown>;
        output?: string;
        message?: string;
      };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }

      switch (msg.type) {
        case "history": {
          const count = Array.isArray((msg as { messages?: unknown }).messages)
            ? (msg as { messages: unknown[] }).messages.length
            : 0;
          log.info(`Session history: ${count} messages`);
          break;
        }

        case "chunk": {
          const delta = msg.content ?? "";
          if (delta) parser.feed(delta);
          break;
        }

        case "tool_call": {
          // Structured WS tool message — flush any buffered text first
          parser.flush();
          currentToolCallId = crypto.randomUUID();
          writer.write({
            type: "tool-input-available",
            toolCallId: currentToolCallId,
            toolName: msg.name ?? "unknown",
            input: msg.args ?? {},
            dynamic: true,
          });
          break;
        }

        case "tool_result": {
          writer.write({
            type: "tool-output-available",
            toolCallId: currentToolCallId,
            output: msg.output ?? "completed",
            dynamic: true,
          });
          break;
        }

        case "message":
        case "done": {
          // Flush any remaining buffered chunk content
          parser.flush();

          if (parser.hasEmitted) {
            // Content was streamed via chunks — already emitted
            cleanup();
            settle(() => resolve());
          } else {
            // No chunks received — parse the full response for tags + images
            const raw = (msg.full_response ?? msg.content ?? "").trim();
            const finalContent =
              raw || "Tool execution completed, but no final response text was returned.";
            cleanup();
            embedImages(sandbox, root, finalContent).then(
              (enriched) => {
                emitParsedResponse(writer, enriched);
                settle(() => resolve());
              },
              (err) => settle(() => reject(err)),
            );
          }
          break;
        }

        case "error": {
          parser.flush();
          writer.write({
            type: "error",
            errorText: msg.message ?? "Unknown error",
          });
          cleanup();
          settle(() => resolve());
          break;
        }
      }
    });

    ws.on("error", (err: Error) => {
      parser.flush();
      writer.write({
        type: "error",
        errorText: err.message ?? "Connection error",
      });
      cleanup();
      settle(() => resolve());
    });

    ws.on("close", (code: number) => {
      parser.flush();
      if (code !== 1000) {
        settle(() => reject(new Error(`WebSocket closed with code ${code}`)));
      } else {
        settle(() => resolve());
      }
    });
  });
}
