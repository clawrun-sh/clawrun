import { VercelPlatformProvider } from "./vercel.js";
import type { PlatformProvider } from "./types.js";

const providers: Record<string, () => PlatformProvider> = {
  vercel: () => new VercelPlatformProvider(),
};

export function getPlatformProvider(id: string): PlatformProvider {
  const factory = providers[id];
  if (!factory) {
    const known = Object.keys(providers).join(", ") || "(none)";
    throw new Error(`Unknown platform: "${id}". Available: ${known}`);
  }
  return factory();
}

export type {
  LogsOptions,
  PlatformProvider,
  PlatformTier,
  PlatformLimits,
  ProjectHandle,
  StateStoreEntry,
  StateStoreResult,
} from "./types.js";
