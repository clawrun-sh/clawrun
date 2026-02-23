import type { Agent } from "@cloudclaw/agent";
import { ZeroclawAgent } from "@cloudclaw/agent/zeroclaw";

const agents: Record<string, Agent> = {
  zeroclaw: new ZeroclawAgent(),
};

const DEFAULT_AGENT = "zeroclaw";

export function getAgent(id?: string): Agent {
  const agentId = id ?? DEFAULT_AGENT;
  const agent = agents[agentId];
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  return agent;
}
