import type { SandboxProvider, ProviderOptions } from "./types.js";

const factories: Record<string, (options?: ProviderOptions) => SandboxProvider> = {};

export function registerProviderFactory(
  name: string,
  factory: (options?: ProviderOptions) => SandboxProvider,
): void {
  factories[name] = factory;
}

export function getProvider(id: string, options?: ProviderOptions): SandboxProvider {
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
