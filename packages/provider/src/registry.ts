import type { SandboxProvider, ProviderOptions, ProviderId } from "./types.js";
import type { PlatformProvider } from "./platform-types.js";

// --- Sandbox provider registry ---

const factories: Record<string, (options?: ProviderOptions) => SandboxProvider> = {};

export function registerProviderFactory(
  name: ProviderId,
  factory: (options?: ProviderOptions) => SandboxProvider,
): void {
  factories[name] = factory;
}

export function getProvider(id: ProviderId, options?: ProviderOptions): SandboxProvider {
  const factory = factories[id];
  if (!factory) {
    const known = Object.keys(factories).join(", ") || "(none)";
    throw new Error(
      `Unknown sandbox provider: "${id}". Available: ${known}\n` +
        `Hint: ensure the provider package is imported before calling getProvider().`,
    );
  }
  return factory(options);
}

// --- Platform provider registry ---

const platformFactories: Record<string, () => PlatformProvider> = {};

export function registerPlatformFactory(name: ProviderId, factory: () => PlatformProvider): void {
  platformFactories[name] = factory;
}

export function getPlatformProvider(id: ProviderId): PlatformProvider {
  const factory = platformFactories[id];
  if (!factory) {
    const known = Object.keys(platformFactories).join(", ") || "(none)";
    throw new Error(
      `Unknown platform: "${id}". Available: ${known}\n` +
        `Hint: ensure the provider package is imported before calling getPlatformProvider().`,
    );
  }
  return factory();
}
