import type { SandboxProvider } from "./types.js";
import { VercelSandboxProvider } from "./vercel.js";

const providers: Record<string, () => SandboxProvider> = {
  vercel: () => new VercelSandboxProvider(),
};

export function getProvider(id: string): SandboxProvider {
  const factory = providers[id];
  if (!factory) {
    const known = Object.keys(providers).join(", ") || "(none)";
    throw new Error(`Unknown sandbox provider: "${id}". Available: ${known}`);
  }
  return factory();
}
