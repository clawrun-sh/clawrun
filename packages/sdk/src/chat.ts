import { EventSourceParserStream } from "eventsource-parser/stream";
import { readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import type { ApiClient } from "./api-client.js";
import type { ChatStream, ChatOptions } from "./types.js";
import { ChatStreamError } from "./errors.js";

/**
 * Create a ChatStream that lazily initiates an SSE connection when iterated.
 *
 * The stream can be consumed either event-by-event (async iteration) or
 * all at once via `result()`.
 */
export function createChatStream(
  apiClient: ApiClient,
  message: string,
  options?: ChatOptions,
): ChatStream {
  let responsePromise: Promise<Response> | undefined;
  let consumed = false;

  function getResponse(): Promise<Response> {
    if (!responsePromise) {
      responsePromise = apiClient.rawPost(
        "/api/v1/chat",
        { message, id: options?.id },
        options?.signal,
      );
    }
    return responsePromise;
  }

  async function* iterate(): AsyncIterableIterator<UIMessageChunk> {
    if (consumed) {
      throw new Error(
        "ChatStream has already been consumed. Create a new stream to iterate again.",
      );
    }
    consumed = true;

    const res = await getResponse();

    if (!res.body) return;

    const eventStream = res.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream());

    for await (const { data } of eventStream) {
      if (data === "[DONE]") break;
      try {
        yield JSON.parse(data) as UIMessageChunk;
      } catch {
        // Malformed event data — skip
      }
    }
  }

  async function result(): Promise<UIMessage> {
    // Collect all chunks, detecting error events along the way.
    const chunks: UIMessageChunk[] = [];
    let errorText: string | undefined;

    for await (const chunk of iterate()) {
      if (chunk.type === "error") {
        const c = chunk as Record<string, unknown>;
        errorText = typeof c.errorText === "string" ? c.errorText : "Unknown stream error";
        break;
      }
      chunks.push(chunk);
    }

    if (errorText) {
      throw new ChatStreamError(errorText);
    }

    // Pipe collected chunks through readUIMessageStream for accumulation.
    const chunkStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    let lastMessage: UIMessage | undefined;
    for await (const msg of readUIMessageStream({ stream: chunkStream })) {
      lastMessage = msg;
    }

    return lastMessage ?? { id: "", role: "assistant", parts: [] };
  }

  return {
    [Symbol.asyncIterator]() {
      return iterate();
    },
    result,
  };
}
