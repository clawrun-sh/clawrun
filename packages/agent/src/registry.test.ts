import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("agent registry", () => {
  it("creates agent from registered factory", async () => {
    const { registerAgentFactory, createAgent } = await import("./registry.js");
    const mockAgent = { name: "mock" } as any;
    registerAgentFactory("mock", () => mockAgent);

    expect(createAgent("mock")).toBe(mockAgent);
  });

  it("throws on unknown agent with available list", async () => {
    const { registerAgentFactory, createAgent } = await import("./registry.js");
    registerAgentFactory("zeroclaw", () => ({}) as any);

    expect(() => createAgent("nanobot")).toThrow(/Unknown agent: "nanobot"/);
    expect(() => createAgent("nanobot")).toThrow(/Available: zeroclaw/);
  });

  it("throws with (none) when no agents registered", async () => {
    const { createAgent } = await import("./registry.js");

    expect(() => createAgent("anything")).toThrow(/Available: \(none\)/);
  });

  it("includes hint about importing agent package", async () => {
    const { createAgent } = await import("./registry.js");

    expect(() => createAgent("x")).toThrow(/Hint: ensure the agent package/);
  });
});
