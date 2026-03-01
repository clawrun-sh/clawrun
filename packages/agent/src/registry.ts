import type { Agent } from "./types.js";

const factories: Record<string, () => Agent> = {};

export function registerAgentFactory(name: string, factory: () => Agent): void {
  factories[name] = factory;
}

export function createAgent(name: string): Agent {
  const factory = factories[name];
  if (!factory) {
    const known = Object.keys(factories).join(", ") || "(none)";
    throw new Error(
      `Unknown agent: "${name}". Available: ${known}\n` +
        `Hint: ensure the agent package is imported before calling createAgent().`,
    );
  }
  return factory();
}
