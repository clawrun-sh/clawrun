import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("provider registry", () => {
  it("creates provider from registered factory", async () => {
    const { registerProviderFactory, getProvider } = await import("./registry.js");
    const mockProvider = { name: "mock" } as any;
    registerProviderFactory("mock", () => mockProvider);

    expect(getProvider("mock")).toBe(mockProvider);
  });

  it("passes options to factory", async () => {
    const { registerProviderFactory, getProvider } = await import("./registry.js");
    const factory = vi.fn(() => ({}) as any);
    registerProviderFactory("vercel", factory);

    const options = { apiToken: "tok" } as any;
    getProvider("vercel", options);

    expect(factory).toHaveBeenCalledWith(options);
  });

  it("throws on unknown provider with available list", async () => {
    const { registerProviderFactory, getProvider } = await import("./registry.js");
    registerProviderFactory("vercel", () => ({}) as any);

    expect(() => getProvider("aws")).toThrow(/Unknown sandbox provider: "aws"/);
    expect(() => getProvider("aws")).toThrow(/Available: vercel/);
  });

  it("throws with (none) when no providers registered", async () => {
    const { getProvider } = await import("./registry.js");

    expect(() => getProvider("anything")).toThrow(/Available: \(none\)/);
  });
});
