import { parseOutput, buildAgentCommand, DAEMON_PORT } from "zeroclaw";
import WebSocket from "ws";
import type {
  SandboxHandle,
  AgentResponse,
  ToolCallInfo,
  ThreadInfo,
  AgentStatus,
  AgentConfig,
  RuntimeToolInfo,
  CliToolInfo,
  CronJob,
  MemoryEntryInfo,
  CostInfo,
  DiagResult,
} from "@clawrun/agent";
import type { UIMessage, UIMessageStreamWriter } from "ai";
import { createLogger } from "@clawrun/logger";

const log = createLogger("zeroclaw:ws");

// --- Daemon WS protocol types ---

/** History entry from the agent daemon. */
export type HistoryMessage = { role: string; content: string };

/**
 * Superset of all daemon WebSocket message shapes across both `/ws/chat` and
 * `/ws/clawrun` protocols. Not all fields are present in every message — the
 * `type` discriminant determines which fields are meaningful.
 */
interface DaemonWsMessage {
  type?:
    | "message"
    | "chunk"
    | "done"
    | "error"
    | "history" // both protocols
    | "tool_call"
    | "tool_result" // /ws/chat only
    | "status"
    | "tool_progress"
    | "clear"; // /ws/clawrun only
  content?: string;
  full_response?: string;
  message?: string;
  // /ws/chat structured tool fields
  name?: string;
  args?: Record<string, unknown>;
  output?: string;
  // history payload
  messages?: HistoryMessage[];
  thread_id?: string;
}

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
const _KNOWN_TAGS = ["thinking", "response", "tool_call", "tool_result"] as const;

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

/**
 * Split a text chunk into word-sized pieces for progressive streaming.
 *
 * Matches the AI SDK `smoothStream` default ("word") chunking pattern:
 * each piece is a word with its trailing whitespace attached, so the
 * concatenation of all pieces equals the original text.
 */
export function splitTextForStreaming(text: string): string[] {
  if (text.length <= 8) return [text];
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

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
    // Split large chunks into word-sized deltas for progressive streaming.
    // The pull-based merge stream adds a macrotask delay between each write,
    // ensuring every delta gets its own SSE event and TCP segment.
    for (const delta of splitTextForStreaming(content)) {
      this.writer.write({ type: "text-delta", id: this.textId, delta });
    }
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
 * Parse an emoji-prefixed progress line from `/ws/clawrun` `tool_progress`
 * messages into a structured descriptor.
 *
 * Recognised formats:
 *   `⏳ shell: pwd`    → pending, name="shell", hint="pwd"
 *   `⏳ shell`         → pending, name="shell", hint=""
 *   `✅ shell (2s)`    → completed, success=true
 *   `❌ shell (2s)`    → completed, success=false
 *
 * Returns `null` for unrecognised lines.
 */
export function parseProgressLine(
  line: string,
): { name: string; hint: string; completed: boolean; success?: boolean } | null {
  const pending = line.match(/^⏳\s+(\S+)(?::\s+(.*))?$/);
  if (pending) return { name: pending[1], hint: pending[2]?.trim() ?? "", completed: false };
  const success = line.match(/^✅\s+(\S+)\s+\(\d+s\)$/);
  if (success) return { name: success[1], hint: "", completed: true, success: true };
  const fail = line.match(/^❌\s+(\S+)\s+\(\d+s\)$/);
  if (fail) return { name: fail[1], hint: "", completed: true, success: false };
  return null;
}

/**
 * Parse a complete response text for tags and emit all appropriate AI SDK
 * stream events. Used for the done/message fallback when no chunks were
 * streamed.
 */
function emitParsedResponse(writer: UIMessageStreamWriter, text: string): void {
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

// --- Daemon WebSocket URL helper ---

export function buildDaemonWsUrl(sandbox: SandboxHandle, path: string, threadId?: string): string {
  const daemonUrl = sandbox.domain!(DAEMON_PORT);
  let wsUrl = daemonUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + path;
  if (threadId) {
    wsUrl += `?thread_id=${encodeURIComponent(threadId)}`;
  }
  return wsUrl;
}

// --- Fetch history via daemon WebSocket ---

async function fetchHistoryViaWs(
  sandbox: SandboxHandle,
  threadId: string,
  path: string,
  opts?: { signal?: AbortSignal },
): Promise<HistoryMessage[]> {
  const wsUrl = buildDaemonWsUrl(sandbox, path, threadId);
  log.info(`fetchHistory url=${wsUrl} threadId=${threadId}`);

  return new Promise<HistoryMessage[]>((resolve, reject) => {
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
        const msg = JSON.parse(data.toString()) as DaemonWsMessage;
        if (msg.type === "history") {
          const messages = Array.isArray(msg.messages) ? msg.messages : [];
          log.info(
            `fetchHistory received ${messages.length} messages, roles=[${messages.map((m) => m.role).join(", ")}]`,
          );
          cleanup();
          resolve(messages);
        } else {
          log.debug(`fetchHistory ignored message type=${msg.type}`);
        }
      } catch (err) {
        log.warn(`fetchHistory JSON parse error: ${err instanceof Error ? err.message : err}`);
      }
    });

    ws.on("error", (err: Error) => {
      log.warn(`fetchHistory ws error: ${err.message}`);
      cleanup();
      reject(err);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      log.info(`fetchHistory ws closed code=${code} reason=${reason?.toString() || "none"}`);
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
    threadId?: string;
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

/**
 * Send a message and collect a batch AgentResponse. Handles both /ws/chat and
 * /ws/clawrun protocols — the superset of message types is switched; types that
 * a given protocol never sends simply never match.
 */
async function sendViaWs(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  path: string,
  opts?: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    threadId?: string;
  },
): Promise<AgentResponse> {
  const wsUrl = buildDaemonWsUrl(sandbox, path, opts?.threadId);
  log.info(`send url=${wsUrl} threadId=${opts?.threadId ?? "(none)"}`);

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
      let msg: DaemonWsMessage;
      try {
        msg = JSON.parse(data.toString()) as DaemonWsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "history": {
          const count = Array.isArray(msg.messages) ? msg.messages.length : 0;
          log.info(`Session history: ${count} messages`);
          break;
        }
        case "chunk": {
          pendingContent += msg.content ?? "";
          break;
        }
        // /ws/chat: structured tool messages
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
        // /ws/clawrun: informational events
        case "status":
        case "tool_progress": {
          log.debug(`${msg.type}: ${msg.content ?? ""}`);
          break;
        }
        case "clear": {
          pendingContent = "";
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
 * events directly to the writer. Handles both /ws/chat and /ws/clawrun
 * protocols — the superset of message types is switched; types that a given
 * protocol never sends simply never match.
 *
 * Chunks are processed through StreamingTagParser which handles:
 *   - `<thinking>` → reasoning-start/delta/end
 *   - `<response>` → text (unwrapped)
 *   - `<tool_call>` → tool-input-available
 *   - `<tool_result>` → tool-output-available
 *
 * /ws/chat may also send structured `tool_call`/`tool_result` WS messages
 * which are handled alongside the XML tag parsing.
 *
 * /ws/clawrun may send `status`, `tool_progress`, and `clear` events which
 * are logged or used to flush the parser.
 */
async function streamViaWs(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  writer: UIMessageStreamWriter,
  path: string,
  opts?: { signal?: AbortSignal; threadId?: string },
): Promise<void> {
  const wsUrl = buildDaemonWsUrl(sandbox, path, opts?.threadId);
  log.info(`stream url=${wsUrl} threadId=${opts?.threadId ?? "(none)"}`);

  const isClawrun = path === "/ws/clawrun";

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const signal = opts?.signal;
    let settled = false;

    // Null writer pattern: for /ws/clawrun, pre-clear chunks go to a
    // discarded writer (intermediate tool-loop output); only post-clear
    // chunks stream to the real writer (final answer).
    const nullWriter = { write: () => {} } as unknown as UIMessageStreamWriter;

    let parser = new StreamingTagParser(isClawrun ? nullWriter : writer);
    let receivedClear = false;

    // Track current tool call ID for structured WS tool messages (/ws/chat)
    let currentToolCallId = "";

    // Tool progress tracking for /ws/clawrun
    interface TrackedToolEntry {
      name: string;
      hint: string;
      toolCallId: string;
      completed: boolean;
    }
    const trackedTools: TrackedToolEntry[] = [];

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

    // -- Async message handler (extracted for queue-based processing) ----------
    async function handleMessage(msg: DaemonWsMessage): Promise<void> {
      switch (msg.type) {
        case "history": {
          const count = Array.isArray(msg.messages) ? msg.messages.length : 0;
          log.info(`Session history: ${count} messages`);
          break;
        }

        case "chunk": {
          const delta = msg.content ?? "";
          if (delta) parser.feed(delta);
          break;
        }

        // /ws/chat: structured tool messages
        case "tool_call": {
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

        // /ws/clawrun: informational events
        case "status": {
          log.debug(`status: ${msg.content ?? ""}`);
          break;
        }

        case "tool_progress": {
          if (!isClawrun) {
            log.debug(`tool_progress: ${msg.content ?? ""}`);
            break;
          }
          const content = msg.content ?? "";
          const lines = content.split("\n").filter((l: string) => l.trim());
          for (let i = 0; i < lines.length; i++) {
            const parsed = parseProgressLine(lines[i]);
            if (!parsed) continue;
            if (i >= trackedTools.length) {
              // New tool — emit tool-input-available
              const toolCallId = crypto.randomUUID();
              trackedTools.push({
                name: parsed.name,
                hint: parsed.hint,
                toolCallId,
                completed: parsed.completed,
              });
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: parsed.name,
                input: parsed.hint ? { args: parsed.hint } : {},
                dynamic: true,
              });
              if (parsed.completed) {
                if (parsed.success) {
                  writer.write({
                    type: "tool-output-available",
                    toolCallId,
                    output: "completed",
                    dynamic: true,
                  });
                } else {
                  writer.write({
                    type: "tool-output-error",
                    toolCallId,
                    errorText: "Tool execution failed",
                    dynamic: true,
                  });
                }
              }
            } else if (!trackedTools[i].completed && parsed.completed) {
              trackedTools[i].completed = true;
              if (parsed.success) {
                writer.write({
                  type: "tool-output-available",
                  toolCallId: trackedTools[i].toolCallId,
                  output: "completed",
                  dynamic: true,
                });
              } else {
                writer.write({
                  type: "tool-output-error",
                  toolCallId: trackedTools[i].toolCallId,
                  errorText: "Tool execution failed",
                  dynamic: true,
                });
              }
            }
          }
          break;
        }

        case "clear": {
          parser.flush();
          if (isClawrun) {
            receivedClear = true;
            parser = new StreamingTagParser(writer);
          }
          break;
        }

        case "message":
        case "done": {
          // Flush any remaining buffered chunk content
          parser.flush();

          if (isClawrun && receivedClear && parser.hasEmitted) {
            // /ws/clawrun: post-clear content was streamed — embed images then resolve
            cleanup();
            try {
              await embedImages(sandbox, root, msg.full_response ?? "");
              settle(() => resolve());
            } catch (err) {
              settle(() => reject(err as Error));
            }
          } else if (!isClawrun && parser.hasEmitted) {
            // /ws/chat: content was streamed via chunks — already emitted
            cleanup();
            settle(() => resolve());
          } else {
            // No streaming happened — parse the full response for tags + images
            const raw = (msg.full_response ?? msg.content ?? "").trim();
            const finalContent =
              raw || "Tool execution completed, but no final response text was returned.";
            cleanup();
            try {
              const enriched = await embedImages(sandbox, root, finalContent);
              emitParsedResponse(writer, enriched);
              settle(() => resolve());
            } catch (err) {
              settle(() => reject(err as Error));
            }
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
    }

    // Message queue — serializes WS message processing so async handlers
    // (e.g. embedImages in done/message) don't interleave.
    const messageQueue: DaemonWsMessage[] = [];
    let processingQueue = false;

    async function processQueue(): Promise<void> {
      if (processingQueue) return;
      processingQueue = true;
      while (messageQueue.length > 0 && !settled) {
        const msg = messageQueue.shift()!;
        await handleMessage(msg);
      }
      processingQueue = false;
    }

    ws.on("message", (data: Buffer) => {
      let msg: DaemonWsMessage;
      try {
        msg = JSON.parse(data.toString()) as DaemonWsMessage;
      } catch {
        return;
      }
      messageQueue.push(msg);
      processQueue();
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

// ---------------------------------------------------------------------------
// Public exports — try /ws/clawrun first, fall back to /ws/chat
// ---------------------------------------------------------------------------

export async function fetchHistoryViaDaemon(
  sandbox: SandboxHandle,
  root: string,
  threadId: string,
  opts?: { signal?: AbortSignal },
): Promise<HistoryMessage[]> {
  try {
    return await fetchHistoryViaWs(sandbox, threadId, "/ws/clawrun", opts);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    log.warn(
      `/ws/clawrun unavailable for history, using /ws/chat: ${err instanceof Error ? err.message : err}`,
    );
  }
  try {
    return await fetchHistoryViaWs(sandbox, threadId, "/ws/chat", opts);
  } catch {
    return [];
  }
}

export async function sendMessageViaDaemon(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  opts?: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    threadId?: string;
  },
): Promise<AgentResponse> {
  try {
    return await sendViaWs(sandbox, root, message, "/ws/clawrun", opts);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    log.warn(
      `/ws/clawrun unavailable, using /ws/chat: ${err instanceof Error ? err.message : err}`,
    );
  }
  return await sendViaWs(sandbox, root, message, "/ws/chat", opts);
}

export async function streamMessageViaDaemon(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  writer: UIMessageStreamWriter,
  opts?: { signal?: AbortSignal; threadId?: string },
): Promise<void> {
  try {
    return await streamViaWs(sandbox, root, message, writer, "/ws/clawrun", opts);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    log.warn(
      `/ws/clawrun unavailable, using /ws/chat: ${err instanceof Error ? err.message : err}`,
    );
  }
  return await streamViaWs(sandbox, root, message, writer, "/ws/chat", opts);
}

// ---------------------------------------------------------------------------
// Memory API — thread listing and retrieval via daemon HTTP
// ---------------------------------------------------------------------------

/** Entry returned by ZeroClaw's `/api/memory` endpoint. */
export interface MemoryEntry {
  key: string;
  content: string;
  category?: string;
  /** Daemon returns `timestamp`, not `created_at`. */
  timestamp: string;
  session_id?: string | null;
}

// --- Key parsing ---

const ASSISTANT_KEY_PREFIX = "assistant_resp_";

const CHANNEL_NAMES: Record<string, string> = {
  clawrun: "ClawRun",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
  irc: "IRC",
  matrix: "Matrix",
  lark: "Lark",
  dingtalk: "DingTalk",
  qq: "QQ",
  linq: "LinQ",
};

export interface ParsedMemoryKey {
  role: "user" | "assistant";
  channel: string;
  threadId: string;
}

/**
 * Parse a ZeroClaw memory key to extract role, channel, and thread ID.
 *
 * Key formats:
 *   User:      `{channel}_{...}_{suffix}`
 *   Assistant:  `assistant_resp_{channel}_{...}_{suffix}`
 *
 * Thread ID extraction:
 *   ClawRun: `clawrun_{threadId}_{uuid}` → `clawrun_{threadId}`
 *   Others:  `{channel}_{sender}_{msgId}` → `{channel}_{sender}`
 */
export function parseMemoryKey(key: string): ParsedMemoryKey | null {
  const isAssistant = key.startsWith(ASSISTANT_KEY_PREFIX);
  const baseKey = isAssistant ? key.slice(ASSISTANT_KEY_PREFIX.length) : key;

  const firstUnderscore = baseKey.indexOf("_");
  if (firstUnderscore === -1) return null;

  const channelKey = baseKey.slice(0, firstUnderscore);
  const channel = CHANNEL_NAMES[channelKey];
  if (!channel) return null;

  const rest = baseKey.slice(firstUnderscore + 1);
  if (!rest) return null;

  let threadPart: string;
  if (channelKey === "clawrun") {
    // clawrun_{threadId}_{uuid} — UUID uses hyphens (8-4-4-4-12)
    const match = rest.match(/^(.+)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    threadPart = match ? match[1] : rest;
  } else {
    // {channel}_{sender}_{msgId} — strip last segment (message-unique ID)
    const lastUnderscore = rest.lastIndexOf("_");
    threadPart = lastUnderscore > 0 ? rest.slice(0, lastUnderscore) : rest;
  }

  return {
    role: isAssistant ? "assistant" : "user",
    channel,
    threadId: `${channelKey}_${threadPart}`,
  };
}

// --- Parse assistant XML into UIMessage parts ---

/**
 * Parse assistant response content with XML tags into AI SDK UIMessage parts.
 *
 * Handles `<thinking>`, `<tool_call name="...">JSON</tool_call>`,
 * `<tool_result>`, and `<response>` wrappers.
 */
export function parseAssistantParts(content: string): UIMessage["parts"] {
  if (
    !content.includes("<thinking>") &&
    !content.includes("<tool_call") &&
    !content.includes("<response>")
  ) {
    return [{ type: "text" as const, text: content }];
  }

  const parts: UIMessage["parts"] = [];
  let remaining = content;

  while (remaining.length > 0) {
    const thinkIdx = remaining.indexOf("<thinking>");
    const toolIdx = remaining.search(/<tool_call\s/);
    const respIdx = remaining.indexOf("<response>");

    const candidates = [
      { idx: thinkIdx, tag: "thinking" as const },
      { idx: toolIdx, tag: "tool_call" as const },
      { idx: respIdx, tag: "response" as const },
    ]
      .filter((c) => c.idx >= 0)
      .sort((a, b) => a.idx - b.idx);

    if (candidates.length === 0) {
      const clean = remaining
        .replace(/<\/(?:thinking|response)>/g, "")
        .replace(/<tool_result\s+[^>]*\/>/g, "")
        .trim();
      if (clean) parts.push({ type: "text" as const, text: clean });
      break;
    }

    const { idx, tag } = candidates[0];
    const before = remaining.slice(0, idx).trim();
    if (before) parts.push({ type: "text" as const, text: before });

    if (tag === "thinking") {
      const end = remaining.indexOf("</thinking>", idx);
      if (end === -1) {
        remaining = remaining.slice(idx + "<thinking>".length);
        continue;
      }
      const inner = remaining.slice(idx + "<thinking>".length, end).trim();
      if (inner) {
        parts.push({ type: "reasoning" as const, text: inner });
      }
      remaining = remaining.slice(end + "</thinking>".length);
    } else if (tag === "tool_call") {
      const openMatch = remaining.slice(idx).match(/^<tool_call\s+(?:name|type)="([^"]+)">/);
      if (!openMatch) {
        remaining = remaining.slice(idx + 1);
        continue;
      }
      const name = openMatch[1];
      const afterOpen = idx + openMatch[0].length;
      const end = remaining.indexOf("</tool_call>", afterOpen);
      if (end === -1) {
        remaining = remaining.slice(afterOpen);
        continue;
      }
      const argsStr = remaining.slice(afterOpen, end).trim();
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(argsStr);
      } catch {}
      remaining = remaining.slice(end + "</tool_call>".length);

      // Consume following tool_result if present
      let output: string = "completed";
      const resultMatch = remaining.match(/^\s*<tool_result[^>]*>([\s\S]*?)<\/tool_result>/);
      if (resultMatch) {
        output = resultMatch[1].trim() || "completed";
        remaining = remaining.slice(resultMatch[0].length);
      }

      parts.push({
        type: "dynamic-tool" as const,
        toolName: name,
        toolCallId: crypto.randomUUID(),
        state: "output-available" as const,
        input,
        output,
      });
    } else if (tag === "response") {
      const end = remaining.indexOf("</response>", idx);
      if (end === -1) {
        remaining = remaining.slice(idx + "<response>".length);
        continue;
      }
      const inner = remaining.slice(idx + "<response>".length, end).trim();
      if (inner) parts.push({ type: "text" as const, text: inner });
      remaining = remaining.slice(end + "</response>".length);
    }
  }

  return parts.length > 0 ? parts : [{ type: "text" as const, text: content }];
}

// --- Daemon HTTP helpers ---

async function fetchMemoryEntries(
  sandbox: SandboxHandle,
  params: Record<string, string>,
  opts?: { signal?: AbortSignal },
): Promise<MemoryEntry[]> {
  const base = sandbox.domain!(DAEMON_PORT) + "/api/memory";
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${base}?${qs}` : base;
  log.info(`fetchMemory url=${url}`);
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Memory API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  // Daemon wraps entries in { entries: [...] }
  return (Array.isArray(data) ? data : (data.entries ?? [])) as MemoryEntry[];
}

// --- Dashboard API helpers (daemon HTTP) ---

function daemonBase(sandbox: SandboxHandle): string {
  return sandbox.domain!(DAEMON_PORT);
}

export async function fetchAgentStatus(
  sandbox: SandboxHandle,
  opts?: { signal?: AbortSignal },
): Promise<AgentStatus> {
  const url = daemonBase(sandbox) + "/api/status";
  log.info(`fetchAgentStatus url=${url}`);
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Status API ${res.status}: ${res.statusText}`);
  const raw = await res.json();

  // Map snake_case ZeroClaw response → AgentStatus
  const channels: string[] = [];
  if (raw.channels && typeof raw.channels === "object") {
    for (const [name, enabled] of Object.entries(raw.channels)) {
      if (enabled) channels.push(name);
    }
  } else if (Array.isArray(raw.channels)) {
    channels.push(...raw.channels);
  }

  const health: AgentStatus["health"] = [];
  const comps = raw.health?.components;
  if (comps && typeof comps === "object") {
    for (const [name, c] of Object.entries(comps) as [string, any][]) {
      health.push({
        name,
        status: c.status ?? "unknown",
        restarts: c.restart_count ?? c.restarts,
      });
    }
  } else if (Array.isArray(raw.health)) {
    health.push(...raw.health);
  }

  return {
    provider: raw.provider,
    model: raw.model,
    uptime: raw.uptime_seconds ?? raw.uptime,
    memoryBackend: raw.memory_backend ?? raw.memoryBackend,
    channels,
    health,
  };
}

export async function fetchAgentConfig(
  sandbox: SandboxHandle,
  opts?: { signal?: AbortSignal },
): Promise<AgentConfig> {
  const url = daemonBase(sandbox) + "/api/config";
  log.info(`fetchAgentConfig url=${url}`);
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Config API ${res.status}: ${res.statusText}`);
  return (await res.json()) as AgentConfig;
}

export async function putAgentConfig(
  sandbox: SandboxHandle,
  content: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const url = daemonBase(sandbox) + "/api/config";
  log.info(`putAgentConfig url=${url}`);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Config PUT ${res.status}: ${res.statusText}`);
}

export async function fetchRuntimeTools(
  sandbox: SandboxHandle,
  opts?: { signal?: AbortSignal },
): Promise<{ tools: RuntimeToolInfo[]; cliTools: CliToolInfo[] }> {
  const url = daemonBase(sandbox) + "/api/tools";
  log.info(`fetchRuntimeTools url=${url}`);
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Tools API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return {
    tools: Array.isArray(data.tools) ? data.tools : [],
    cliTools: Array.isArray(data.cli_tools ?? data.cliTools)
      ? (data.cli_tools ?? data.cliTools)
      : [],
  };
}

export async function fetchCronJobs(
  sandbox: SandboxHandle,
  opts?: { signal?: AbortSignal },
): Promise<CronJob[]> {
  const url = daemonBase(sandbox) + "/api/cron";
  log.info(`fetchCronJobs url=${url}`);
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Cron API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const raw: Record<string, unknown>[] = Array.isArray(data) ? data : (data.jobs ?? []);
  return raw.map(
    (j): CronJob => ({
      id: String(j.id ?? ""),
      name: j.name != null ? String(j.name) : undefined,
      schedule: String(j.schedule ?? ""),
      command: String(j.command ?? ""),
      nextRun:
        j.nextRun != null ? String(j.nextRun) : j.next_run != null ? String(j.next_run) : undefined,
      lastRun:
        j.lastRun != null ? String(j.lastRun) : j.last_run != null ? String(j.last_run) : undefined,
      lastStatus:
        j.lastStatus != null
          ? String(j.lastStatus)
          : j.last_status != null
            ? String(j.last_status)
            : undefined,
      enabled: j.enabled != null ? Boolean(j.enabled) : undefined,
    }),
  );
}

export async function postCronJob(
  sandbox: SandboxHandle,
  job: { name?: string; schedule: string; command: string },
  opts?: { signal?: AbortSignal },
): Promise<CronJob> {
  const url = daemonBase(sandbox) + "/api/cron";
  log.info(`postCronJob url=${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Cron POST ${res.status}: ${res.statusText}`);
  return (await res.json()) as CronJob;
}

export async function deleteCronJobVia(
  sandbox: SandboxHandle,
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const url = daemonBase(sandbox) + `/api/cron/${encodeURIComponent(id)}`;
  log.info(`deleteCronJob url=${url}`);
  const res = await fetch(url, { method: "DELETE", signal: opts?.signal });
  if (!res.ok) throw new Error(`Cron DELETE ${res.status}: ${res.statusText}`);
}

export async function fetchMemories(
  sandbox: SandboxHandle,
  query?: { query?: string; category?: string },
  opts?: { signal?: AbortSignal },
): Promise<MemoryEntryInfo[]> {
  const params: Record<string, string> = {};
  if (query?.query) params.query = query.query;
  if (query?.category) params.category = query.category;
  const entries = await fetchMemoryEntries(sandbox, params, opts);
  return entries.map((e) => ({
    key: e.key,
    content: e.content,
    category: e.category,
    timestamp: e.timestamp,
  }));
}

export async function postMemory(
  sandbox: SandboxHandle,
  entry: { key: string; content: string; category?: string },
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const url = daemonBase(sandbox) + "/api/memory";
  log.info(`postMemory url=${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Memory POST ${res.status}: ${res.statusText}`);
}

export async function deleteMemoryEntry(
  sandbox: SandboxHandle,
  key: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const url = daemonBase(sandbox) + `/api/memory/${encodeURIComponent(key)}`;
  log.info(`deleteMemory url=${url}`);
  const res = await fetch(url, { method: "DELETE", signal: opts?.signal });
  if (!res.ok) throw new Error(`Memory DELETE ${res.status}: ${res.statusText}`);
}

export async function fetchCostInfo(
  sandbox: SandboxHandle,
  opts?: { signal?: AbortSignal },
): Promise<CostInfo> {
  const url = daemonBase(sandbox) + "/api/cost";
  log.info(`fetchCostInfo url=${url}`);
  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) throw new Error(`Cost API ${res.status}: ${res.statusText}`);
  const raw = await res.json();

  // Unwrap optional `cost` envelope and map snake_case → CostInfo
  const c = raw.cost ?? raw;
  return {
    sessionCost: c.session_cost_usd ?? c.sessionCost,
    dailyCost: c.daily_cost_usd ?? c.dailyCost,
    monthlyCost: c.monthly_cost_usd ?? c.monthlyCost,
    totalTokens: c.total_tokens ?? c.totalTokens,
    requestCount: c.request_count ?? c.requestCount,
    byModel: Array.isArray(c.by_model)
      ? c.by_model
      : c.by_model && typeof c.by_model === "object"
        ? Object.entries(c.by_model).map(([model, v]: [string, any]) => ({
            model,
            cost: v.cost_usd ?? v.cost ?? 0,
            tokens: v.total_tokens ?? v.tokens ?? 0,
            requests: v.request_count ?? v.requests ?? 0,
            share: v.share ?? 0,
          }))
        : undefined,
  };
}

export async function fetchDiagnostics(
  sandbox: SandboxHandle,
  opts?: { signal?: AbortSignal },
): Promise<DiagResult[]> {
  const url = daemonBase(sandbox) + "/api/diagnostics";
  log.info(`fetchDiagnostics url=${url}`);
  const res = await fetch(url, {
    method: "POST",
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`Diagnostics API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.results ?? []);
}

// --- Thread listing ---

export async function listThreadsViaDaemon(
  sandbox: SandboxHandle,
  opts?: { signal?: AbortSignal },
): Promise<ThreadInfo[]> {
  const entries = await fetchMemoryEntries(sandbox, { category: "conversation" }, opts);

  // Group entries by thread ID
  const threads = new Map<
    string,
    {
      channel: string;
      messages: Array<{ role: string; content: string; createdAt: string }>;
    }
  >();

  for (const entry of entries) {
    const parsed = parseMemoryKey(entry.key);
    if (!parsed) continue;

    let thread = threads.get(parsed.threadId);
    if (!thread) {
      thread = { channel: parsed.channel, messages: [] };
      threads.set(parsed.threadId, thread);
    }
    thread.messages.push({
      role: parsed.role,
      content: entry.content,
      createdAt: entry.timestamp,
    });
  }

  // Build ThreadInfo array
  const result: ThreadInfo[] = [];
  for (const [threadId, thread] of threads) {
    thread.messages.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Preview: last user message, truncated
    const lastUserMsg = [...thread.messages].reverse().find((m) => m.role === "user");
    const preview =
      (lastUserMsg ?? thread.messages[thread.messages.length - 1])?.content.slice(0, 100) ?? "";

    const lastActivity = thread.messages[thread.messages.length - 1]?.createdAt ?? "";

    result.push({
      id: threadId,
      channel: thread.channel,
      preview,
      messageCount: thread.messages.length,
      lastActivity,
    });
  }

  // Most recent first
  result.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  return result;
}

// --- Thread retrieval ---

export async function getThreadViaDaemon(
  sandbox: SandboxHandle,
  threadId: string,
  opts?: { signal?: AbortSignal },
): Promise<UIMessage[]> {
  const entries = await fetchMemoryEntries(sandbox, { query: threadId }, opts);

  // Filter to entries that actually belong to this thread
  const threadEntries = entries.filter((entry) => {
    const parsed = parseMemoryKey(entry.key);
    return parsed?.threadId === threadId;
  });

  // Sort by timestamp (oldest first)
  threadEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Convert to UIMessage[]
  return threadEntries
    .map((entry): UIMessage | null => {
      const parsed = parseMemoryKey(entry.key);
      if (!parsed) return null;

      const content = entry.content.trim();
      if (!content) return null;

      if (parsed.role === "user") {
        return {
          id: crypto.randomUUID(),
          role: "user" as const,
          parts: [{ type: "text" as const, text: content }],
        };
      }

      return {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        parts: parseAssistantParts(content),
      };
    })
    .filter((msg): msg is UIMessage => msg !== null);
}
