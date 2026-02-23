import type { WakeHookAdapter } from "./types.js";
import { TelegramWakeHookAdapter } from "./adapters/telegram.js";

const adapters: Map<string, WakeHookAdapter> = new Map();

// Register built-in adapters
function register(adapter: WakeHookAdapter): void {
  adapters.set(adapter.channelId, adapter);
}

register(new TelegramWakeHookAdapter());

/** Get an adapter by channel ID. Returns undefined if not registered. */
export function getAdapter(channelId: string): WakeHookAdapter | undefined {
  return adapters.get(channelId);
}

/** Get all registered adapters. */
export function getAllAdapters(): WakeHookAdapter[] {
  return [...adapters.values()];
}

/** Get adapters that have their required env vars configured. */
export function getConfiguredAdapters(): WakeHookAdapter[] {
  return getAllAdapters().filter((a) => a.isConfigured());
}
