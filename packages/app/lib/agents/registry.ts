import type { AgentAdapter } from "zeroclaw/adapter";
import { zeroclawAdapter } from "zeroclaw/adapter";

const agents: Record<string, AgentAdapter> = {
  [zeroclawAdapter.id]: zeroclawAdapter,
};

const DEFAULT_AGENT = "zeroclaw";

export function getAgent(id?: string): AgentAdapter {
  const agentId = id ?? DEFAULT_AGENT;
  const adapter = agents[agentId];
  if (!adapter) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  return adapter;
}
