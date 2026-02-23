import { getConfiguredAdapters } from "./registry.js";

/**
 * Register wake hooks for all configured programmable-webhook channels.
 *
 * Called when the sandbox stops — each adapter registers its webhook so the
 * platform pushes messages to CloudClaw's endpoint.
 *
 * Always-on channels (programmableWebhook === false) are skipped — their
 * webhooks are permanently configured and the handler checks sandbox state.
 */
export async function registerWakeHooks(baseUrl: string): Promise<void> {
  for (const adapter of getConfiguredAdapters()) {
    if (!adapter.programmableWebhook) continue;

    const webhookUrl = `${baseUrl}/api/v1/webhook/${adapter.channelId}`;
    try {
      await adapter.registerWebhook(webhookUrl);
      console.log(`[CloudClaw] Registered wake hook: ${adapter.name} → ${webhookUrl}`);
    } catch (err) {
      console.error(`[CloudClaw] Failed to register wake hook for ${adapter.name}:`, err);
    }
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
  for (const adapter of getConfiguredAdapters()) {
    if (!adapter.programmableWebhook) continue;

    try {
      await adapter.deleteWebhook();
      console.log(`[CloudClaw] Torn down wake hook: ${adapter.name}`);
    } catch (err) {
      console.error(`[CloudClaw] Failed to tear down wake hook for ${adapter.name}:`, err);
    }
  }
}
