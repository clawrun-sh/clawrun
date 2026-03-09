import { createUIMessageStream } from "ai";
import type { TextUIPart, UIMessageChunk } from "ai";
import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

/** Maximum allowed message length (characters). */
const MAX_MESSAGE_LENGTH = 32_000;

/**
 * Delay (ms) inserted between text/reasoning delta SSE events for progressive
 * streaming. Matches the AI SDK `smoothStream` default. Without this pause,
 * word-level deltas coalesce into a single TCP write.
 */
const SSE_DELTA_DELAY_MS = 10;

const log = createLogger("handler:chat");

/** Vercel Pro/Enterprise function timeout (seconds). */
export const maxDuration = 150;

export async function POST(req: Request) {
  let body: { message?: unknown; messages?: unknown; threadId?: unknown };
  try {
    body = (await req.json()) as { message?: unknown; messages?: unknown; threadId?: unknown };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : undefined;
  log.info(
    `[chat] threadId=${threadId ?? "(none)"} bodyKeys=${Object.keys(body as Record<string, unknown>).join(",")}`,
  );

  // Accept both { message } (CLI) and { messages } (useChat).
  let message: string | undefined;
  if (typeof body.message === "string" && body.message.trim()) {
    message = body.message.trim();
  } else if (Array.isArray(body.messages) && body.messages.length > 0) {
    const last = body.messages[body.messages.length - 1];
    if (last && typeof last.content === "string" && last.content.trim()) {
      message = last.content.trim();
    } else if (last && Array.isArray(last.parts)) {
      const textPart = (last.parts as Array<{ type: string; text?: string }>).find(
        (p): p is TextUIPart => p.type === "text" && typeof p.text === "string",
      );
      if (textPart) message = textPart.text.trim();
    }
  }

  if (!message) {
    return new Response("Missing or empty message", { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return new Response("Message too long", { status: 400 });
  }

  const stream = createUIMessageStream({
    async execute({ writer }) {
      try {
        const manager = new SandboxLifecycleManager();
        const result = await manager.wake();

        if (result.status === "failed" || !result.sandboxId) {
          log.error("Wake failed:", result.error ?? "unknown");
          writer.write({
            type: "error",
            errorText: "Failed to start sandbox — please try again",
          });
          return;
        }

        const config = getRuntimeConfig();
        const provider = getProvider(config.instance.provider);
        const sandbox = await provider.get(result.sandboxId);

        const root = await resolveRoot(sandbox);

        const agent = getAgent();

        await agent.streamMessage(sandbox, root, message, writer, {
          signal: AbortSignal.timeout(120_000),
          threadId,
        });
      } catch (err) {
        log.error("Chat error:", err instanceof Error ? err.message : "Unknown error");
        writer.write({
          type: "error",
          errorText: "Something went wrong — please try again",
        });
      }
    },
  });

  // Format stream parts as SSE events with a small delay between text/reasoning
  // deltas for progressive streaming. Without the delay, all word-deltas from a
  // single daemon WS chunk are written synchronously and coalesce into one TCP
  // write. The pause matches the AI SDK smoothStream default and gives the
  // HTTP response pipeline time to flush each event individually.
  const DELTA_TYPES = new Set<UIMessageChunk["type"]>(["text-delta", "reasoning-delta"]);

  const sseStream = stream
    .pipeThrough(
      new TransformStream<UIMessageChunk, string>({
        async transform(part, controller) {
          controller.enqueue(`data: ${JSON.stringify(part)}\n\n`);
          if (DELTA_TYPES.has(part.type)) {
            await new Promise<void>((r) => setTimeout(r, SSE_DELTA_DELAY_MS));
          }
        },
        flush(controller) {
          controller.enqueue("data: [DONE]\n\n");
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());

  return new Response(sseStream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
      "x-accel-buffering": "no",
    },
  });
}
