import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SANDBOX_DEFAULTS } from "./schema.js";

// We test getRuntimeConfig by mocking fs and process.cwd, since it reads clawrun.json from disk.
// The module caches results, so we re-import per test.

function makeValidConfig(overrides: Record<string, unknown> = {}) {
  return {
    instance: { provider: "vercel", name: "test-instance" },
    agent: { name: "zeroclaw" },
    sandbox: {},
    ...overrides,
  };
}

describe("getRuntimeConfig — sandbox memory computation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("computes memory as vcpus * 2048 for default vcpus", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.resources.memory).toBe(SANDBOX_DEFAULTS.vcpus * 2048);
  });

  it("computes memory as vcpus * 2048 for 4 vcpus", async () => {
    const configData = makeValidConfig({
      sandbox: { resources: { vcpus: 4 } },
    });
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.resources.memory).toBe(4 * 2048);
  });

  it("computes memory as vcpus * 2048 for 8 vcpus", async () => {
    const configData = makeValidConfig({
      sandbox: { resources: { vcpus: 8 } },
    });
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.resources.memory).toBe(8 * 2048);
  });
});

describe("getRuntimeConfig — sandbox defaults from Zod schema", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses SANDBOX_DEFAULTS.activeDuration when not specified", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.activeDuration).toBe(SANDBOX_DEFAULTS.activeDuration);
  });

  it("uses SANDBOX_DEFAULTS.cronKeepAliveWindow when not specified", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.cronKeepAliveWindow).toBe(SANDBOX_DEFAULTS.cronKeepAliveWindow);
  });

  it("uses SANDBOX_DEFAULTS.cronWakeLeadTime when not specified", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.cronWakeLeadTime).toBe(SANDBOX_DEFAULTS.cronWakeLeadTime);
  });

  it("uses SANDBOX_DEFAULTS.vcpus when not specified", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.resources.vcpus).toBe(SANDBOX_DEFAULTS.vcpus);
  });

  it("defaults networkPolicy to 'allow-all'", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.networkPolicy).toBe("allow-all");
  });
});

describe("getRuntimeConfig — sandbox overrides", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses provided activeDuration over default", async () => {
    const configData = makeValidConfig({
      sandbox: { activeDuration: 300 },
    });
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.activeDuration).toBe(300);
  });

  it("uses provided networkPolicy over default", async () => {
    const configData = makeValidConfig({
      sandbox: { networkPolicy: "deny-all" },
    });
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.sandbox.networkPolicy).toBe("deny-all");
  });
});

describe("getRuntimeConfig — instance fields", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps instance.name from config", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.instance.name).toBe("test-instance");
  });

  it("maps instance.provider from config", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.instance.provider).toBe("vercel");
  });

  it("maps instance.sandboxRoot from config default", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.instance.sandboxRoot).toBe(".clawrun");
  });

  it("uses deployedUrl as baseUrl when provided", async () => {
    const configData = makeValidConfig({
      instance: {
        provider: "vercel",
        name: "test",
        deployedUrl: "https://example.vercel.app",
      },
    });
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.instance.baseUrl).toBe("https://example.vercel.app");
  });

  it("falls back to CLAWRUN_BASE_URL env when deployedUrl is absent", async () => {
    const configData = makeValidConfig();
    process.env.CLAWRUN_BASE_URL = "https://env-url.example.com";
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.instance.baseUrl).toBe("https://env-url.example.com");
    delete process.env.CLAWRUN_BASE_URL;
  });

  it("returns undefined baseUrl when both deployedUrl and env are absent", async () => {
    delete process.env.CLAWRUN_BASE_URL;
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.instance.baseUrl).toBeUndefined();
  });

  it("uses deployedUrl over CLAWRUN_BASE_URL when both are set", async () => {
    process.env.CLAWRUN_BASE_URL = "https://env-url.example.com";
    const configData = makeValidConfig({
      instance: {
        provider: "vercel",
        name: "test",
        deployedUrl: "https://deployed.example.com",
      },
    });
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.instance.baseUrl).toBe("https://deployed.example.com");
    delete process.env.CLAWRUN_BASE_URL;
  });
});

describe("getRuntimeConfig — agent fields", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps agent.name from config", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.agent.name).toBe("zeroclaw");
  });

  it("defaults agent.config to 'agent/config.toml'", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.agent.config).toBe("agent/config.toml");
  });

  it("defaults agent.bundlePaths to empty array", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.agent.bundlePaths).toEqual([]);
  });
});

describe("getRuntimeConfig — webhook secrets from env", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any env vars we set
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CLAWRUN_WEBHOOK_SECRET_")) {
        delete process.env[key];
      }
    }
  });

  it("reads CLAWRUN_WEBHOOK_SECRET_TELEGRAM from env", async () => {
    process.env.CLAWRUN_WEBHOOK_SECRET_TELEGRAM = "tg-secret-123";
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.secrets?.webhookSecrets?.telegram).toBe("tg-secret-123");
  });

  it("lowercases channel names from env vars", async () => {
    process.env.CLAWRUN_WEBHOOK_SECRET_DISCORD = "dc-secret";
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.secrets?.webhookSecrets?.discord).toBe("dc-secret");
  });

  it("returns empty webhookSecrets when no env vars match", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.secrets?.webhookSecrets).toEqual({});
  });

  it("skips env vars with empty string values", async () => {
    process.env.CLAWRUN_WEBHOOK_SECRET_SLACK = "";
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(config.secrets?.webhookSecrets).not.toHaveProperty("slack");
  });

  it("collects multiple channel secrets simultaneously", async () => {
    process.env.CLAWRUN_WEBHOOK_SECRET_TELEGRAM = "tg-sec";
    process.env.CLAWRUN_WEBHOOK_SECRET_DISCORD = "dc-sec";
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const config = getRuntimeConfig();
    expect(Object.keys(config.secrets?.webhookSecrets ?? {})).toHaveLength(2);
  });
});

describe("getRuntimeConfig — caching", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same object reference on subsequent calls", async () => {
    const configData = makeValidConfig();
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    const first = getRuntimeConfig();
    const second = getRuntimeConfig();
    expect(first).toBe(second);
  });
});

describe("getRuntimeConfig — invalid config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when clawrun.json contains invalid JSON", async () => {
    vi.doMock("node:fs", () => ({
      readFileSync: () => "not valid json{",
    }));
    const { getRuntimeConfig } = await import("./config.js");
    expect(() => getRuntimeConfig()).toThrow();
  });

  it("throws when config is missing required instance.provider", async () => {
    const configData = { instance: {}, agent: { name: "zeroclaw" } };
    vi.doMock("node:fs", () => ({
      readFileSync: () => JSON.stringify(configData),
    }));
    const { getRuntimeConfig } = await import("./config.js");
    expect(() => getRuntimeConfig()).toThrow();
  });
});
