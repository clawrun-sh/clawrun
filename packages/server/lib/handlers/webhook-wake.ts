import { getAdapter } from "@clawrun/channel";
import { getProvider } from "@clawrun/provider";
import { getAgent, getRuntimeConfig, resolveRoot, SandboxLifecycleManager } from "@clawrun/runtime";
import { createLogger } from "@clawrun/logger";

const log = createLogger("handler:webhook");

/**
 * Handle GET requests for webhook URL verification (e.g. WhatsApp hub.challenge).
 *
 * Some platforms verify webhook URLs by sending a GET request with a challenge
 * parameter that must be echoed back. This handler delegates to the adapter's
 * handleVerifyGet() method if present.
 */
export async function handleWakeWebhookGet(req: Request, channelId: string): Promise<Response> {
  const adapter = getAdapter(channelId);
  if (!adapter) {
    return new Response("Unknown channel", { status: 404 });
  }

  if (adapter.handleVerifyGet) {
    const response = adapter.handleVerifyGet(req);
    if (response) return response;
  }

  return new Response("Method Not Allowed", { status: 405 });
}

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
 *   8. Wake sandbox with skipTeardownWakeHooks — webhook stays active until
 *      we forward the triggering message to the agent
 *   9. Forward the triggering message to the agent, send response via adapter,
 *      then tear down the webhook
 *  10. Return 200 (message handled) or adapter-specific status (fallback)
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
  // later after the message is forwarded to the agent.
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

  // 8. Send courtesy message (best-effort) — skip if adapter already acknowledged
  if (signal.chatId && !signal.acknowledged) {
    await adapter.sendMessage(signal.chatId, "Waking up, one moment...");
  }

  // 9. Wake sandbox — delay webhook teardown so we can forward the message first
  const manager = new SandboxLifecycleManager();
  let result: Awaited<ReturnType<typeof manager.wake>>;
  try {
    result = await manager.wake({ skipTeardownWakeHooks: true });
  } catch (err) {
    log.error(`Webhook-triggered wake failed (${channelId}):`, err);
    // Best-effort teardown even on failure
    try {
      await manager.teardownWakeHooks();
    } catch {}
    return new Response(null, { status: adapter.wakeResponseStatus });
  }

  // 10. Forward the triggering message to the agent, then tear down hooks
  if (
    signal.messageText &&
    signal.chatId &&
    result.status === "running" &&
    result.sandboxId
  ) {
    try {
      const config = getRuntimeConfig();
      const provider = getProvider(config.instance.provider);
      const sandbox = await provider.get(result.sandboxId);

      const root = await resolveRoot(sandbox);

      const agent = getAgent();
      const resp = await agent.sendMessage(sandbox, root, signal.messageText, {
        signal: AbortSignal.timeout(120_000),
      });

      if (resp.success && resp.message) {
        await adapter.sendMessage(signal.chatId, resp.message);
      }
    } catch (err) {
      log.error(`Failed to forward wake message to agent (${channelId}):`, err);
    }
  }

  // Always tear down hooks after forwarding (or on fallback)
  try {
    await manager.teardownWakeHooks();
  } catch (err) {
    log.error(`Failed to tear down wake hooks (${channelId}):`, err);
  }

  return new Response(null, { status: 200 });
}
