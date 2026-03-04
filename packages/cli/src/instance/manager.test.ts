import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  cpSync: vi.fn(),
}));

vi.mock("./paths.js", () => ({
  clawrunHome: () => "/home/user/.clawrun",
  instancesDir: () => "/home/user/.clawrun",
  instanceDir: (name: string) => `/home/user/.clawrun/${name}`,
  instanceAgentDir: (name: string) => `/home/user/.clawrun/${name}/agent`,
  instanceDeployDir: (name: string) => `/home/user/.clawrun/${name}/.deploy`,
}));

vi.mock("./config.js", () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  sanitizeConfig: vi.fn((c: { instance: unknown; agent: unknown; sandbox: unknown }) => ({
    instance: c.instance,
    agent: c.agent,
    sandbox: c.sandbox,
  })),
}));

vi.mock("@clawrun/agent", () => ({
  createAgent: vi.fn(() => ({
    getBundleFiles: () => ["config.toml"],
    getInstallDependencies: () => ({}),
  })),
}));

vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), step: vi.fn(), success: vi.fn(), error: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
}));

vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "tarball.tgz" })),
}));

vi.mock("chalk", () => ({
  default: { dim: (s: string) => s },
}));

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { readConfig } from "./config.js";
import type { ClawRunConfigWithSecrets } from "./config.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Minimal config for mocking ---
function fakeConfig(overrides?: Record<string, Record<string, unknown>>): ClawRunConfigWithSecrets {
  return {
    instance: { name: "my-bot", preset: "starter", provider: "vercel", ...overrides?.instance },
    agent: {
      name: "zeroclaw",
      config: "agent/config.toml",
      bundlePaths: [],
      configPaths: [],
      ...overrides?.agent,
    },
    sandbox: { activeDuration: 600, resources: { vcpus: 2 }, networkPolicy: "allow-all" },
    secrets: { cronSecret: "c", jwtSecret: "j", sandboxSecret: "s" },
    ...overrides,
  } as unknown as ClawRunConfigWithSecrets;
}

describe("listInstances", () => {
  let listInstances: typeof import("./manager.js").listInstances;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./manager.js");
    listInstances = mod.listInstances;
  });

  it("returns empty array when instances dir does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(listInstances()).toEqual([]);
  });

  it("returns instances with metadata", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: "my-bot", isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(readConfig).mockReturnValue(fakeConfig());
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "1.0.0" }));

    const instances = listInstances();

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe("my-bot");
    expect(instances[0].preset).toBe("starter");
    expect(instances[0].agent).toBe("zeroclaw");
    expect(instances[0].appVersion).toBe("1.0.0");
  });

  it("skips non-directories", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: "file.txt", isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>);

    expect(listInstances()).toEqual([]);
  });

  it("skips directories without clawrun.json", () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path) === "/home/user/.clawrun") return true;
      if (String(path).endsWith("clawrun.json")) return false;
      return true;
    });
    vi.mocked(readdirSync).mockReturnValue([
      { name: "orphan", isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(readConfig).mockReturnValue(null);

    expect(listInstances()).toEqual([]);
  });
});

describe("getInstance", () => {
  let getInstance: typeof import("./manager.js").getInstance;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./manager.js");
    getInstance = mod.getInstance;
  });

  it("returns null when config is missing", () => {
    vi.mocked(readConfig).mockReturnValue(null);
    expect(getInstance("missing")).toBeNull();
  });

  it("returns metadata when instance exists", () => {
    vi.mocked(readConfig).mockReturnValue(fakeConfig());
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "2.0.0" }));

    const meta = getInstance("my-bot");
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe("my-bot");
    expect(meta!.appVersion).toBe("2.0.0");
  });
});

describe("instanceExists", () => {
  let instanceExists: typeof import("./manager.js").instanceExists;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./manager.js");
    instanceExists = mod.instanceExists;
  });

  it("returns true when clawrun.json exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    expect(instanceExists("my-bot")).toBe(true);
  });

  it("returns false when clawrun.json is missing", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(instanceExists("missing")).toBe(false);
  });
});

describe("saveDeployedUrl", () => {
  let saveDeployedUrl: typeof import("./manager.js").saveDeployedUrl;
  let writeConfig: typeof import("./config.js").writeConfig;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./manager.js");
    saveDeployedUrl = mod.saveDeployedUrl;
    const configMod = await import("./config.js");
    writeConfig = configMod.writeConfig;
  });

  it("updates deployedUrl and writes config", () => {
    const config = fakeConfig();
    vi.mocked(readConfig).mockReturnValue(config);

    saveDeployedUrl("my-bot", "https://my-bot.vercel.app");

    expect(config.instance.deployedUrl).toBe("https://my-bot.vercel.app");
    expect(writeConfig).toHaveBeenCalledWith("my-bot", config);
  });

  it("throws when config is missing", () => {
    vi.mocked(readConfig).mockReturnValue(null);

    expect(() => saveDeployedUrl("missing", "https://x.com")).toThrow(/No clawrun\.json/);
  });
});

describe("destroyInstance", () => {
  let destroyInstance: typeof import("./manager.js").destroyInstance;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./manager.js");
    destroyInstance = mod.destroyInstance;
  });

  it("removes instance directory", () => {
    vi.mocked(existsSync).mockReturnValue(true);

    destroyInstance("my-bot");

    expect(rmSync).toHaveBeenCalledWith("/home/user/.clawrun/my-bot", {
      recursive: true,
      force: true,
    });
  });

  it("throws when instance does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => destroyInstance("missing")).toThrow(/does not exist/);
  });
});
