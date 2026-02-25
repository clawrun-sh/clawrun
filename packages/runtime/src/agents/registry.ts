import type { Agent } from "@clawrun/agent";
import { getRuntimeConfig } from "../config.js";

const agents: Record<string, Agent> = {};

/** Register an agent adapter so it can be resolved by name. */
export function registerAgent(id: string, agent: Agent): void {
  agents[id] = agent;
}

export function getAgent(id?: string): Agent {
  const agentId = id ?? getRuntimeConfig().agent.name;
  const agent = agents[agentId];
  if (!agent) {
    const known = Object.keys(agents).join(", ") || "(none)";
    throw new Error(`Unknown agent: "${agentId}". Registered agents: ${known}`);
  }
  return agent;
}
