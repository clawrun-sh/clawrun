import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent } from "@clawrun/agent";

vi.mock("../config.js", () => ({
  getRuntimeConfig: vi.fn(() => ({ agent: { name: "zeroclaw" } })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("runtime agent registry", () => {
  it("registers and retrieves agent by id", async () => {
    const { registerAgent, getAgent } = await import("./registry.js");
    const agent = { name: "mock" } as unknown as Agent;
    registerAgent("mock", agent);

    expect(getAgent("mock")).toBe(agent);
  });

  it("falls back to config agent name when no id provided", async () => {
    const { registerAgent, getAgent } = await import("./registry.js");
    const agent = { name: "zeroclaw" } as unknown as Agent;
    registerAgent("zeroclaw", agent);

    expect(getAgent()).toBe(agent);
  });

  it("throws on unknown agent with registered list", async () => {
    const { registerAgent, getAgent } = await import("./registry.js");
    registerAgent("zeroclaw", {} as unknown as Agent);

    expect(() => getAgent("nanobot")).toThrow(/Unknown agent: "nanobot"/);
    expect(() => getAgent("nanobot")).toThrow(/Registered agents: zeroclaw/);
  });

  it("throws with (none) when no agents registered", async () => {
    const { getAgent } = await import("./registry.js");

    expect(() => getAgent("anything")).toThrow(/\(none\)/);
  });
});
