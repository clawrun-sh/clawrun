import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxProvider, ProviderOptions, ProviderId } from "./types.js";

beforeEach(() => {
  vi.resetModules();
});

describe("provider registry", () => {
  it("creates provider from registered factory", async () => {
    const { registerProviderFactory, getProvider } = await import("./registry.js");
    const mockProvider = { name: "mock" } as unknown as SandboxProvider;
    registerProviderFactory("mock" as ProviderId, () => mockProvider);

    expect(getProvider("mock" as ProviderId)).toBe(mockProvider);
  });

  it("passes options to factory", async () => {
    const { registerProviderFactory, getProvider } = await import("./registry.js");
    const factory = vi.fn(() => ({}) as unknown as SandboxProvider);
    registerProviderFactory("vercel", factory);

    const options: ProviderOptions = { projectDir: "tok" };
    getProvider("vercel", options);

    expect(factory).toHaveBeenCalledWith(options);
  });

  it("throws on unknown provider with available list", async () => {
    const { registerProviderFactory, getProvider } = await import("./registry.js");
    registerProviderFactory("vercel", () => ({}) as unknown as SandboxProvider);

    expect(() => getProvider("aws" as ProviderId)).toThrow(/Unknown sandbox provider: "aws"/);
    expect(() => getProvider("aws" as ProviderId)).toThrow(/Available: vercel/);
  });

  it("throws with (none) when no providers registered", async () => {
    const { getProvider } = await import("./registry.js");

    expect(() => getProvider("anything" as ProviderId)).toThrow(/Available: \(none\)/);
  });
});
