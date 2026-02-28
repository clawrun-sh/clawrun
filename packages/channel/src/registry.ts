import type { WakeHookAdapter } from "./types.js";
import { TelegramWakeHookAdapter } from "./telegram/wake-hook.js";

type WakeHookFactory = (
  credentials: Record<string, string>,
  webhookSecret: string,
) => WakeHookAdapter;

// Factory registry — declares which channels CAN have wake hooks
const factories = new Map<string, WakeHookFactory>();
factories.set("telegram", (creds, secret) => new TelegramWakeHookAdapter(creds.bot_token, secret));

// Live adapter registry — populated at boot via initializeAdapters()
const adapters: Map<string, WakeHookAdapter> = new Map();

/**
 * Called once at server boot. Creates adapters for configured channels.
 *
 * Adapters are created for any channel that has credentials, even without a
 * webhook verification secret. This ensures teardownWakeHooks() can delete
 * stale webhooks from previous deployments. Without this, an old webhook
 * pointing to a dead URL blocks ZeroClaw's getUpdates polling.
 *
 * @param channelConfigs - Per-channel credential maps from agent config, e.g.
 *   `{ telegram: { bot_token: "123:ABC" }, discord: { bot_token: "..." } }`
 * @param webhookSecrets - Per-channel webhook verification secrets from clawrun.json, e.g.
 *   `{ telegram: "random-secret" }`
 */
export function initializeAdapters(
  channelConfigs: Record<string, Record<string, string>>,
  webhookSecrets: Record<string, string>,
): void {
  adapters.clear();
  for (const [channelId, factory] of factories) {
    const creds = channelConfigs[channelId];
    if (creds) {
      // Use webhook secret if available, fall back to empty string.
      // Empty secret means verifyRequest() will reject all incoming
      // wake requests — but deleteWebhook() and registerWebhook() still
      // work, which is critical for teardown on sandbox start.
      const secret = webhookSecrets[channelId] ?? "";
      adapters.set(channelId, factory(creds, secret));
    }
  }
}

/** Get an adapter by channel ID. Returns undefined if not registered. */
export function getAdapter(channelId: string): WakeHookAdapter | undefined {
  return adapters.get(channelId);
}

/** Get all initialized adapters. Every adapter in this list is configured. */
export function getAllAdapters(): WakeHookAdapter[] {
  return [...adapters.values()];
}

/** Does a wake hook adapter exist for this channel ID? (CLI-time query) */
export function hasWakeHook(channelId: string): boolean {
  return factories.has(channelId);
}
