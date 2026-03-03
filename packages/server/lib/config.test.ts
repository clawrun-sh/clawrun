import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("createNextConfig", () => {
  it("includes core external packages", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { createNextConfig } = await import("./config.js");
    const config = createNextConfig();

    expect(config.serverExternalPackages).toContain("@clawrun/runtime");
    expect(config.serverExternalPackages).toContain("@clawrun/agent");
    expect(config.serverExternalPackages).toContain("@clawrun/channel");
    expect(config.serverExternalPackages).toContain("@clawrun/provider");
    expect(config.serverExternalPackages).toContain("@clawrun/logger");
  });

  it("adds agent and provider packages from clawrun.json", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path).endsWith("clawrun.json")) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        agent: { name: "zeroclaw", bundlePaths: ["bin/zeroclaw"] },
        instance: { provider: "vercel" },
        serverExternalPackages: ["@vercel/sandbox"],
      }) as any,
    );

    const { createNextConfig } = await import("./config.js");
    const config = createNextConfig();

    expect(config.serverExternalPackages).toContain("@clawrun/agent-zeroclaw");
    expect(config.serverExternalPackages).toContain("@clawrun/provider-vercel");
    expect(config.serverExternalPackages).toContain("@vercel/sandbox");
  });

  it("includes agent bundle paths in outputFileTracingIncludes", async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path).endsWith("clawrun.json")) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        agent: { name: "zeroclaw", bundlePaths: ["bin/zeroclaw"], configPaths: ["config.toml"] },
        instance: { provider: "vercel" },
      }) as any,
    );

    const { createNextConfig } = await import("./config.js");
    const config = createNextConfig();

    const paths = config.outputFileTracingIncludes?.["/"] as string[];
    expect(paths).toContain("./bin/zeroclaw");
    expect(paths).toContain("./clawrun.json");
    expect(paths).toContain("./agent/config.toml");
    expect(paths).toEqual(expect.arrayContaining([expect.stringContaining("sidecar")]));
  });

  it("always transpiles @clawrun/ui", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { createNextConfig } = await import("./config.js");
    const config = createNextConfig();

    expect(config.transpilePackages).toContain("@clawrun/ui");
  });

  it("merges overrides", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { createNextConfig } = await import("./config.js");
    const config = createNextConfig({ reactStrictMode: true });

    expect(config.reactStrictMode).toBe(true);
  });
});
