import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("./paths.js", () => ({
  instanceDir: (name: string) => `/home/user/.clawrun/${name}`,
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildConfig,
  toEnvVars,
  sanitizeConfig,
  readConfig,
  writeConfig,
  configPath,
} from "./config.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// Minimal valid args for buildConfig
function validBuildArgs() {
  return {
    name: "my-bot",
    preset: "starter",
    agentName: "zeroclaw",
    options: {
      cronSecret: "cron-abc",
      jwtSecret: "jwt-abc",
      sandboxSecret: "sbx-abc",
      provider: "vercel",
    },
  };
}

describe("buildConfig", () => {
  it("returns valid config with required fields", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, options);

    expect(config.instance.name).toBe("my-bot");
    expect(config.instance.preset).toBe("starter");
    expect(config.instance.provider).toBe("vercel");
    expect(config.agent.name).toBe("zeroclaw");
    expect(config.secrets.cronSecret).toBe("cron-abc");
    expect(config.secrets.jwtSecret).toBe("jwt-abc");
    expect(config.secrets.sandboxSecret).toBe("sbx-abc");
  });

  it("applies sandbox defaults via Zod", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, options);

    // Defaults from schema
    expect(config.sandbox.activeDuration).toBeGreaterThan(0);
    expect(config.sandbox.resources.vcpus).toBeGreaterThanOrEqual(2);
    expect(config.sandbox.networkPolicy).toBe("allow-all");
  });

  it("passes through optional overrides", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, {
      ...options,
      activeDuration: 900,
      resources: { vcpus: 4 },
      webhookSecrets: { telegram: "tg-secret" },
      bundlePaths: ["bin/zeroclaw"],
    });

    expect(config.sandbox.activeDuration).toBe(900);
    expect(config.sandbox.resources.vcpus).toBe(4);
    expect(config.secrets.webhookSecrets?.telegram).toBe("tg-secret");
    expect(config.agent.bundlePaths).toContain("bin/zeroclaw");
  });
});

describe("toEnvVars", () => {
  it("includes core secrets", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, options);
    const vars = toEnvVars(config);

    expect(vars.CLAWRUN_CRON_SECRET).toBe("cron-abc");
    expect(vars.CLAWRUN_JWT_SECRET).toBe("jwt-abc");
    expect(vars.CLAWRUN_SANDBOX_SECRET).toBe("sbx-abc");
  });

  it("maps per-channel webhook secrets to uppercase env vars", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, {
      ...options,
      webhookSecrets: { telegram: "tg-s", discord: "dc-s" },
    });
    const vars = toEnvVars(config);

    expect(vars.CLAWRUN_WEBHOOK_SECRET_TELEGRAM).toBe("tg-s");
    expect(vars.CLAWRUN_WEBHOOK_SECRET_DISCORD).toBe("dc-s");
  });

  it("omits webhook vars when none configured", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, options);
    const vars = toEnvVars(config);

    const webhookKeys = Object.keys(vars).filter((k) => k.startsWith("CLAWRUN_WEBHOOK_SECRET_"));
    expect(webhookKeys).toHaveLength(0);
  });
});

describe("sanitizeConfig", () => {
  it("strips secrets and state from config", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, options);
    const safe = sanitizeConfig(config);

    expect(safe).not.toHaveProperty("secrets");
    expect(safe).not.toHaveProperty("state");
    expect(safe.instance.name).toBe("my-bot");
    expect(safe.agent.name).toBe("zeroclaw");
  });
});

describe("configPath", () => {
  it("returns path to clawrun.json for instance", () => {
    const path = configPath("my-bot");
    expect(path).toBe("/home/user/.clawrun/my-bot/clawrun.json");
  });
});

describe("readConfig", () => {
  it("returns null when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(readConfig("missing")).toBeNull();
  });

  it("parses valid config file", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, options);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config) as any);

    const result = readConfig("my-bot");
    expect(result).not.toBeNull();
    expect(result!.instance.name).toBe("my-bot");
  });

  it("throws on invalid config with formatted issues", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ instance: {} }) as any);

    expect(() => readConfig("bad")).toThrow(/Invalid clawrun\.json/);
  });
});

describe("writeConfig", () => {
  it("writes JSON to correct path", () => {
    const { name, preset, agentName, options } = validBuildArgs();
    const config = buildConfig(name, preset, agentName, options);

    writeConfig("my-bot", config);

    expect(writeFileSync).toHaveBeenCalledWith(
      "/home/user/.clawrun/my-bot/clawrun.json",
      expect.stringContaining('"my-bot"'),
    );
  });
});
