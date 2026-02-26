/**
 * Shared SSE chat client for /api/v1/chat.
 *
 * Used by both single-shot mode (agent -m) and the interactive TUI.
 * Parses the `createUIMessageStream` format emitted by the server.
 */

export interface ChatResult {
  success: boolean;
  text: string;
  error?: string;
}

/**
 * POST a message to `/api/v1/chat` and read the SSE response stream.
 *
 * @param deployedUrl  Base URL of the deployed instance.
 * @param jwt          Bearer token for auth.
 * @param message      The user message to send.
 * @param signal       Optional AbortSignal for cancellation/timeout.
 */
export async function sendChatMessage(
  deployedUrl: string,
  jwt: string,
  message: string,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const resp = await fetch(`${deployedUrl}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    return { success: false, text: "", error: `Request failed: ${resp.status}` };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let error: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") break;
      try {
        const event = JSON.parse(payload);
        if (event.type === "text-delta") {
          fullText += event.delta;
        } else if (event.type === "error") {
          error = event.errorText;
        }
      } catch {
        // Malformed SSE data — skip
      }
    }
  }

  if (error) {
    return { success: false, text: error, error };
  }

  return { success: true, text: fullText };
}
