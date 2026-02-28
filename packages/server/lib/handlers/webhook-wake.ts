import { getAdapter } from "@clawrun/channel";
import { SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:webhook");

/**
 * Generic wake webhook handler for any channel.
 *
 * Flow:
 *   1. Look up adapter from registry
 *   2. Read body as Buffer (HMAC/Ed25519 need raw bytes)
 *   3. Verify request authenticity
 *   4. Handle platform challenges (PING, url_verification) — always respond
 *   5. Parse wake signal — null means not a wakeable event
 *   6. For always-on channels: check sandbox state, skip if already running
 *   7. Send courtesy message (best-effort)
 *   8. Wake sandbox — webhook deletion happens inside startNewLocked() after
 *      sidecar is confirmed running (teardownWakeHooks). Returning 503 causes
 *      the messenger to retry, which the creation lock handles idempotently.
 *   9. Return adapter-specific status (503 for Telegram, 200 for most others)
 */
export async function handleWakeWebhook(req: Request, channelId: string): Promise<Response> {
  // 1. Look up adapter
  const adapter = getAdapter(channelId);
  if (!adapter) {
    return new Response("Unknown channel", { status: 404 });
  }

  // 2. Read body as Buffer (needed for HMAC/signature verification)
  let bodyBuffer: Buffer;
  try {
    const arrayBuf = await req.arrayBuffer();
    bodyBuffer = Buffer.from(arrayBuf);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // 3. Verify request
  const auth = await adapter.verifyRequest(req, bodyBuffer);
  if (!auth.valid) {
    // Distinguish server misconfiguration (500) from auth failure (401)
    const status = auth.error === "Server misconfigured" ? 500 : 401;
    return new Response(auth.error ?? "Unauthorized", { status });
  }

  // 4. Parse body as JSON
  let body: unknown;
  try {
    body = JSON.parse(bodyBuffer.toString("utf-8"));
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // 5. Handle platform challenges (must always respond, regardless of sandbox state)
  if (adapter.handleChallenge) {
    const challengeResponse = adapter.handleChallenge(req, body);
    if (challengeResponse) return challengeResponse;
  }

  // 6. Parse wake signal
  const signal = adapter.parseWakeSignal(body);
  if (!signal) {
    // Not a wakeable event (e.g. edited_message, reaction, channel_post)
    return new Response(null, { status: 200 });
  }

  // 7. For always-on channels, check if sandbox is already running.
  // Programmable-webhook channels (Telegram) don't need this check — the
  // webhook only exists when the sandbox is stopped. Webhook deletion happens
  // later inside startNewLocked() → teardownWakeHooks(), after the sidecar is
  // confirmed running. Until then, retries from the messenger (triggered by
  // the 503 response) are handled idempotently by the creation lock.
  if (!adapter.programmableWebhook) {
    try {
      const manager = new SandboxLifecycleManager();
      const status = await manager.getStatus();
      if (status.running) {
        return new Response(null, { status: 200 });
      }
    } catch {
      // Can't check status — proceed with wake attempt
    }
  }

  // 8. Send courtesy message (best-effort)
  if (signal.chatId) {
    await adapter.sendCourtesyMessage(signal.chatId, "Waking up, one moment...");
  }

  // 9. Wake sandbox
  try {
    const manager = new SandboxLifecycleManager();
    await manager.wake();
  } catch (err) {
    log.error(`Webhook-triggered wake failed (${channelId}):`, err);
  }

  // 10. Return adapter-specific status
  return new Response(null, { status: adapter.wakeResponseStatus });
}
