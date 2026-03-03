/**
 * Shared SSE chat client for /api/v1/chat.
 *
 * Used by both single-shot mode (agent -m) and the interactive TUI.
 * Parses the `createUIMessageStream` format emitted by the server
 * using eventsource-parser for spec-compliant SSE handling.
 */

import { EventSourceParserStream } from "eventsource-parser/stream";
import type { ToolCallInfo } from "@clawrun/agent";

export type { ToolCallInfo };

export interface ChatResult {
  success: boolean;
  text: string;
  error?: string;
  toolCalls: ToolCallInfo[];
}

export interface ChatStreamEvent {
  type: "text-delta" | "reasoning-delta" | "tool-input" | "tool-output" | "error";
  delta?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  output?: string;
  errorText?: string;
}

/**
 * POST a message to `/api/v1/chat` and read the SSE response stream.
 *
 * @param deployedUrl  Base URL of the deployed instance.
 * @param jwt          Bearer token for auth.
 * @param message      The user message to send.
 * @param signal       Optional AbortSignal for cancellation/timeout.
 * @param sessionId    Optional session ID for conversation continuity.
 * @param onEvent      Optional callback invoked for each SSE event, enabling
 *                     incremental rendering before the full result is available.
 */
export async function sendChatMessage(
  deployedUrl: string,
  jwt: string,
  message: string,
  signal?: AbortSignal,
  sessionId?: string,
  onEvent?: (event: ChatStreamEvent) => void,
): Promise<ChatResult> {
  const resp = await fetch(`${deployedUrl}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ message, sessionId }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    return { success: false, text: "", error: `Request failed: ${resp.status}`, toolCalls: [] };
  }

  let fullText = "";
  let error: string | undefined;
  const toolCalls: ToolCallInfo[] = [];

  const eventStream = resp.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  for await (const { data } of eventStream) {
    if (data === "[DONE]") break;
    try {
      const event = JSON.parse(data);
      if (event.type === "text-delta") {
        fullText += event.delta;
        onEvent?.({ type: "text-delta", delta: event.delta });
      } else if (event.type === "reasoning-delta") {
        onEvent?.({ type: "reasoning-delta", delta: event.delta });
      } else if (event.type === "tool-input-available") {
        toolCalls.push({
          name: event.toolName,
          arguments: event.input ?? {},
        });
        onEvent?.({ type: "tool-input", toolName: event.toolName, input: event.input ?? {} });
      } else if (event.type === "tool-output-available") {
        // Attach output to the matching tool call
        const tc = toolCalls.find((t) => !t.output && t.name);
        const outputStr =
          event.output != null
            ? typeof event.output === "string"
              ? event.output
              : JSON.stringify(event.output)
            : undefined;
        if (tc && outputStr != null) {
          tc.output = outputStr;
        }
        onEvent?.({ type: "tool-output", output: outputStr });
      } else if (event.type === "error") {
        error = event.errorText;
        onEvent?.({ type: "error", errorText: event.errorText });
      }
    } catch {
      // Malformed event data — skip
    }
  }

  if (error) {
    return { success: false, text: error, error, toolCalls };
  }

  return { success: true, text: fullText, toolCalls };
}
