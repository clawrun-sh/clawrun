import { VercelPlatformProvider } from "./vercel.js";
import type { PlatformProvider } from "./types.js";

const providers: Record<string, () => PlatformProvider> = {
  vercel: () => new VercelPlatformProvider(),
};

export function getPlatformProvider(id?: string): PlatformProvider {
  const providerId = id ?? "vercel";
  const factory = providers[providerId];
  if (!factory) throw new Error(`Unknown platform: ${providerId}`);
  return factory();
}

export type { PlatformProvider, PlatformTier, PlatformLimits } from "./types.js";
