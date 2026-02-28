import { getAllAdapters } from "./registry.js";
import { createLogger } from "@clawrun/logger";

const log = createLogger("channel");

/**
 * Register wake hooks for all configured programmable-webhook channels.
 *
 * Called when the sandbox stops — each adapter registers its webhook so the
 * platform pushes messages to ClawRun's endpoint.
 *
 * Always-on channels (programmableWebhook === false) are skipped — their
 * webhooks are permanently configured and the handler checks sandbox state.
 */
export async function registerWakeHooks(baseUrl: string): Promise<void> {
  const adapters = getAllAdapters();
  if (adapters.length === 0) {
    log.warn("registerWakeHooks: no configured channel adapters found — wake hooks not registered");
    return;
  }

  let registered = 0;
  for (const adapter of adapters) {
    if (!adapter.programmableWebhook) continue;

    const webhookUrl = `${baseUrl}/api/v1/webhook/${adapter.channelId}`;
    try {
      await adapter.registerWebhook(webhookUrl);
      log.info(`Registered wake hook: ${adapter.name} → ${webhookUrl}`);
      registered++;
    } catch (err) {
      log.error(`Failed to register wake hook for ${adapter.name}:`, err);
    }
  }

  if (registered === 0) {
    log.warn("registerWakeHooks: no programmable-webhook adapters registered any hooks");
  }
}

/**
 * Tear down wake hooks for all configured programmable-webhook channels.
 *
 * Called when the sandbox starts — the daemon handles channels directly
 * (Telegram via getUpdates, Discord via Gateway, etc).
 *
 * Always-on channels are skipped — their webhooks remain active but the
 * handler returns 200 without waking when it detects the sandbox is running.
 */
export async function teardownWakeHooks(): Promise<void> {
  const adapters = getAllAdapters();
  if (adapters.length === 0) {
    log.warn("teardownWakeHooks: no configured channel adapters found");
    return;
  }

  for (const adapter of adapters) {
    if (!adapter.programmableWebhook) continue;

    try {
      await adapter.deleteWebhook();
      log.info(`Torn down wake hook: ${adapter.name}`);
    } catch (err) {
      log.error(`Failed to tear down wake hook for ${adapter.name}:`, err);
    }
  }
}
