export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { getAdapter } from "@cloudclaw/channel";
import { SandboxLifecycleManager } from "@cloudclaw/runtime";
import { createLogger } from "@cloudclaw/logger";

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
 *   6. For programmable-webhook channels: delete webhook to stop further deliveries
 *      For always-on channels: check sandbox state, skip if already running
 *   7. Send courtesy message (best-effort)
 *   8. Wake sandbox
 *   9. Return adapter-specific status (503 for Telegram, 200 for most others)
 */
export async function handleWakeWebhook(req: Request, channelId: string): Promise<Response> {
  // 1. Look up adapter
  const adapter = getAdapter(channelId);
  if (!adapter) {
    return new Response("Unknown channel", { status: 404 });
  }

  // Gate on configuration
  if (!adapter.isConfigured()) {
    return new Response(`${adapter.name} not configured`, { status: 200 });
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

  // 7. Channel-specific wake logic
  if (adapter.programmableWebhook) {
    // Category A: Delete webhook to stop further deliveries.
    // Idempotent — safe if multiple in-flight requests call this concurrently.
    await adapter.deleteWebhook();
  } else {
    // Category B (always-on): Check if sandbox is running.
    // If running, the daemon handles messages natively — no wake needed.
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
