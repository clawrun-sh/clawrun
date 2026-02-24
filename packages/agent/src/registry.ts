import type { Agent } from "./types.js";
import { ZeroclawAgent } from "./zeroclaw.js";

const agents: Record<string, () => Agent> = {
  zeroclaw: () => new ZeroclawAgent(),
};

export function createAgent(name: string): Agent {
  const factory = agents[name];
  if (!factory) {
    const known = Object.keys(agents).join(", ") || "(none)";
    throw new Error(`Unknown agent: "${name}". Available: ${known}`);
  }
  return factory();
}
