/**
 * Streaming WebSocket client for the ZeroClaw `/ws/stream` endpoint.
 *
 * Provides drop-in replacements for the daemon WS functions in messaging.ts
 * but uses the streaming protocol: real-time progress, tool status, and text
 * chunks arrive as they happen.
 *
 * The text chunks may contain XML tags (`<thinking>`, `<tool_call>`,
 * `<tool_result>`, `<response>`) which are parsed by `StreamingTagParser`
 * for the streaming path and `extractToolCalls` for the batch path.
 */

import WebSocket from "ws";
import type { SandboxHandle, AgentResponse } from "@clawrun/agent";
import type { UIMessageStreamWriter } from "ai";
import { createLogger } from "@clawrun/logger";
import { DAEMON_PORT } from "zeroclaw";
import { StreamingTagParser, embedImages, emitParsedResponse, extractToolCalls } from "./messaging.js";

const log = createLogger("zeroclaw:ws-stream");

// ---------------------------------------------------------------------------
// Tool progress tracking — parse cumulative progress and emit AI SDK events
// ---------------------------------------------------------------------------

interface TrackedToolEntry {
  name: string;
  hint: string;
  toolCallId: string;
  completed: boolean;
}

/**
 * Parse a single progress line from the daemon's `render_delta()` output.
 * Returns `null` for unrecognised lines.
 *
 * Formats:
 *   ⏳ shell: pwd          → pending tool
 *   ✅ shell (2s)          → completed successfully
 *   ❌ shell (2s)          → completed with error
 */
export function parseProgressLine(
  line: string,
): { name: string; hint: string; completed: boolean; success?: boolean } | null {
  const pending = line.match(/^⏳\s+(\S+)(?::\s+(.*))?$/);
  if (pending) {
    return { name: pending[1], hint: pending[2]?.trim() ?? "", completed: false };
  }
  const success = line.match(/^✅\s+(\S+)\s+\(\d+s\)$/);
  if (success) {
    return { name: success[1], hint: "", completed: true, success: true };
  }
  const fail = line.match(/^❌\s+(\S+)\s+\(\d+s\)$/);
  if (fail) {
    return { name: fail[1], hint: "", completed: true, success: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: build WS URL for /ws/stream
// ---------------------------------------------------------------------------

function buildWsUrl(sandbox: SandboxHandle, sessionId?: string): string {
  const daemonUrl = sandbox.domain!(DAEMON_PORT);
  let wsUrl = daemonUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/stream";
  if (sessionId) {
    wsUrl += `?session_id=${encodeURIComponent(sessionId)}`;
  }
  return wsUrl;
}

// ---------------------------------------------------------------------------
// fetchHistory — retrieve session history via /ws/stream
// ---------------------------------------------------------------------------

export async function fetchHistory(
  sandbox: SandboxHandle,
  root: string,
  sessionId: string,
  opts?: { signal?: AbortSignal },
): Promise<Array<{ role: string; content: string }>> {
  const wsUrl = buildWsUrl(sandbox, sessionId);
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

// ---------------------------------------------------------------------------
// sendMessage — batch send via /ws/stream (waits for done)
// ---------------------------------------------------------------------------

export async function sendMessage(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  opts?: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    sessionId?: string;
  },
): Promise<AgentResponse> {
  const wsUrl = buildWsUrl(sandbox, opts?.sessionId);
  log.info(`sendMessage url=${wsUrl} sessionId=${opts?.sessionId ?? "(none)"}`);

  return new Promise<AgentResponse>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const signal = opts?.signal;
    let settled = false;
    let pendingContent = "";

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

    ws.on("message", (data: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.type as string) {
        case "history": {
          const count = Array.isArray(msg.messages) ? (msg.messages as unknown[]).length : 0;
          log.info(`Session history: ${count} messages`);
          break;
        }
        case "chunk": {
          pendingContent += (msg.content as string) ?? "";
          break;
        }
        case "done": {
          const raw = ((msg.full_response as string) ?? pendingContent).trim();
          const finalContent =
            raw || "Tool execution completed, but no final response text was returned.";
          const { cleanText, toolCalls } = extractToolCalls(finalContent);
          pendingContent = "";
          cleanup();
          embedImages(sandbox, root, cleanText).then(
            (enriched) =>
              settle(() =>
                resolve({
                  success: true,
                  message: enriched,
                  toolCalls,
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
              error: (msg.message as string) ?? "Unknown error",
            }),
          );
          break;
        }
        // status, tool_progress, clear — ignored in batch mode
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

// ---------------------------------------------------------------------------
// streamMessage — streaming via /ws/stream → AI SDK UIMessageStream
// ---------------------------------------------------------------------------

/**
 * Connects to the ZeroClaw daemon `/ws/stream` endpoint and writes AI SDK
 * UIMessageStream events to the writer.
 *
 * The server sends:
 *   - `chunk` — text (may contain `<thinking>`, `<tool_call>`, etc.)
 *   - `status` — progress text ("Thinking...", "Got N tool call(s)")
 *   - `tool_progress` — tool execution progress block
 *   - `clear` — clear accumulated content before final answer
 *   - `done` — full response text
 *   - `error` — error message
 *
 * The daemon sends `clear` between tool-loop iterations and the final answer.
 * Pre-clear chunks are intermediate (tool-calling iterations); post-clear
 * chunks are the final answer. On `clear`, the parser is replaced with a
 * fresh instance so only the final answer content is emitted to the writer.
 *
 * `chunk` text is fed through `StreamingTagParser` which handles:
 *   `<thinking>` → reasoning-start/delta/end
 *   `<response>` → text (unwrapped)
 *   `<tool_call>` → tool-input-available
 *   `<tool_result>` → tool-output-available
 */
export async function streamMessage(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  writer: UIMessageStreamWriter,
  opts?: { signal?: AbortSignal; sessionId?: string },
): Promise<void> {
  const wsUrl = buildWsUrl(sandbox, opts?.sessionId);
  log.info(`streamMessage url=${wsUrl} sessionId=${opts?.sessionId ?? "(none)"}`);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const signal = opts?.signal;
    let settled = false;
    let doneHandled = false;

    // The parser is replaced on `clear` to discard pre-clear intermediate
    // content. Only post-clear (final answer) content reaches the writer.
    // Before the first clear, we buffer to a null writer so intermediate
    // tool-loop output is silently discarded.
    let receivedClear = false;

    // Null writer discards all events (used before first clear)
    const nullWriter = { write: () => {} } as unknown as UIMessageStreamWriter;
    let parser = new StreamingTagParser(nullWriter);

    // Track tool progress entries by index (cumulative from daemon).
    // Tool events are written directly to the real writer (bypass parser).
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

    ws.on("message", (data: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      const msgType = msg.type as string;
      log.info(`[ws] type=${msgType}`);

      switch (msgType) {
        case "history": {
          const count = Array.isArray(msg.messages) ? (msg.messages as unknown[]).length : 0;
          log.info(`[ws] history: ${count} messages`);
          break;
        }

        case "chunk": {
          const delta = (msg.content as string) ?? "";
          log.info(`[ws] chunk len=${delta.length}`);
          if (delta) parser.feed(delta);
          break;
        }

        case "status": {
          log.info(`[ws] status: ${(msg.content as string)?.slice(0, 80)}`);
          break;
        }

        case "tool_progress": {
          const content = (msg.content as string) ?? "";
          log.info(`[ws] tool_progress: ${JSON.stringify(content).slice(0, 200)}`);
          const lines = content.split("\n").filter((l) => l.trim());
          for (let i = 0; i < lines.length; i++) {
            const parsed = parseProgressLine(lines[i]);
            log.info(`[ws] progress line[${i}]=${JSON.stringify(lines[i])} parsed=${JSON.stringify(parsed)}`);
            if (!parsed) continue;

            if (i >= trackedTools.length) {
              // New tool entry — emit tool-input-available
              const toolCallId = crypto.randomUUID();
              trackedTools.push({
                name: parsed.name,
                hint: parsed.hint,
                toolCallId,
                completed: parsed.completed,
              });
              log.info(`[ws] emitting tool-input-available: ${parsed.name} hint=${parsed.hint}`);
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: parsed.name,
                input: parsed.hint ? { args: parsed.hint } : {},
                dynamic: true,
              });
              // If already completed on first appearance, emit output too
              if (parsed.completed) {
                writer.write({
                  type: "tool-output-available",
                  toolCallId,
                  output: parsed.success ? "completed" : "failed",
                  dynamic: true,
                });
              }
            } else if (!trackedTools[i].completed && parsed.completed) {
              // Existing entry transitioned from pending to complete
              trackedTools[i].completed = true;
              log.info(`[ws] emitting tool-output-available: ${trackedTools[i].name}`);
              writer.write({
                type: "tool-output-available",
                toolCallId: trackedTools[i].toolCallId,
                output: parsed.success ? "completed" : "failed",
                dynamic: true,
              });
            }
          }
          break;
        }

        case "clear": {
          log.info(`[ws] clear received`);
          parser.flush();
          receivedClear = true;
          parser = new StreamingTagParser(writer);
          break;
        }

        case "done": {
          doneHandled = true;
          parser.flush();
          const fullLen = ((msg.full_response as string) ?? "").length;
          log.info(`[ws] done: receivedClear=${receivedClear} hasEmitted=${parser.hasEmitted} fullResponseLen=${fullLen} trackedTools=${trackedTools.length}`);

          if (receivedClear && parser.hasEmitted) {
            // Post-clear content was streamed — just check for images
            const fullText = (msg.full_response as string) ?? "";
            cleanup();
            embedImages(sandbox, root, fullText).then(
              () => settle(() => resolve()),
              (err) => settle(() => reject(err)),
            );
          } else {
            // Either no clear (no tools used — chunks went to null writer)
            // or no post-clear chunks. Parse the full response.
            const raw = ((msg.full_response as string) ?? "").trim();
            const finalContent =
              raw || "Tool execution completed, but no final response text was returned.";
            log.info(`[ws] fallback to emitParsedResponse, len=${finalContent.length}`);
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
          doneHandled = true;
          parser.flush();
          log.info(`[ws] error: ${(msg.message as string)?.slice(0, 200)}`);
          writer.write({
            type: "error",
            errorText: (msg.message as string) ?? "Unknown error",
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
      if (!doneHandled) {
        parser.flush();
      }
      if (code !== 1000) {
        settle(() => reject(new Error(`WebSocket closed with code ${code}`)));
      } else {
        settle(() => resolve());
      }
    });
  });
}
