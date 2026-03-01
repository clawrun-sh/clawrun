import { registerAgentFactory } from "@clawrun/agent";
import { ZeroclawAgent } from "./agent.js";

registerAgentFactory("zeroclaw", () => new ZeroclawAgent());
