import { createUIMessageStreamResponse, createUIMessageStream } from "ai";
import type { TextUIPart } from "ai";
import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";
import { requireSessionOrBearerAuth } from "../auth/session";

/** Maximum allowed message length (characters). */
const MAX_MESSAGE_LENGTH = 32_000;

const log = createLogger("handler:chat");

/** Vercel Pro/Enterprise function timeout (seconds). */
export const maxDuration = 150;

export async function POST(req: Request) {
  const denied = await requireSessionOrBearerAuth(req);
  if (denied) return denied;

  let body: { message?: unknown; messages?: unknown; sessionId?: unknown };
  try {
    body = (await req.json()) as { message?: unknown; messages?: unknown; sessionId?: unknown };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;
  log.info(
    `[chat] sessionId=${sessionId ?? "(none)"} bodyKeys=${Object.keys(body as Record<string, unknown>).join(",")}`,
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

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
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

          // Prefer streaming — the agent writes AI SDK stream events directly
          if (agent.streamMessage) {
            await agent.streamMessage(sandbox, root, message, writer, {
              signal: AbortSignal.timeout(120_000),
              sessionId,
            });
          } else {
            // Batch fallback for agents that don't support streaming
            const resp = await agent.sendMessage(sandbox, root, message, {
              signal: AbortSignal.timeout(120_000),
              sessionId,
            });

            if (resp.success) {
              if (resp.toolCalls?.length) {
                for (const tc of resp.toolCalls) {
                  const toolCallId = crypto.randomUUID();
                  writer.write({
                    type: "tool-input-available",
                    toolCallId,
                    toolName: tc.name,
                    input: tc.arguments,
                    dynamic: true,
                  });
                  writer.write({
                    type: "tool-output-available",
                    toolCallId,
                    output: tc.output ?? "completed",
                    dynamic: true,
                  });
                }
              }

              const textId = crypto.randomUUID();
              writer.write({ type: "text-start", id: textId });
              writer.write({ type: "text-delta", id: textId, delta: resp.message });
              writer.write({ type: "text-end", id: textId });
            } else {
              writer.write({
                type: "error",
                errorText: resp.error ?? resp.message,
              });
            }
          }
        } catch (err) {
          log.error("Chat error:", err instanceof Error ? err.message : "Unknown error");
          writer.write({
            type: "error",
            errorText: "Something went wrong — please try again",
          });
        }
      },
    }),
  });
}
