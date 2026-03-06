import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { toEnvVars, sanitizeConfig, buildConfig, readConfig, writeConfig } from "./config.js";

// Use a temp directory for tests that need filesystem access
const TEST_HOME = join("/tmp", `clawrun-config-test-${process.pid}`);

vi.mock("@clawrun/runtime", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@clawrun/runtime")>();
  return {
    ...mod,
  };
});

describe("sanitizeConfig", () => {
  it("removes secrets from config", () => {
    const config = {
      $schema: "https://clawrun.sh/schema.json",
      instance: { name: "test", preset: "starter", provider: "vercel" },
      agent: { name: "zeroclaw" },
      sandbox: { networkPolicy: "allow-all" as const },
      secrets: {
        cronSecret: "secret1",
        jwtSecret: "secret2",
        sandboxSecret: "secret3",
        webhookSecrets: { telegram: "secret4" },
      },
      state: { redisUrl: "redis://localhost" },
    };

    const sanitized = sanitizeConfig(config as any);

    expect(sanitized).toHaveProperty("instance");
    expect(sanitized).toHaveProperty("agent");
    expect(sanitized).toHaveProperty("sandbox");
    expect(sanitized).not.toHaveProperty("secrets");
    expect(sanitized).not.toHaveProperty("state");
  });

  it("preserves $schema", () => {
    const config = {
      $schema: "https://clawrun.sh/schema.json",
      instance: { name: "test" },
      agent: { name: "zeroclaw" },
      sandbox: {},
    };

    const sanitized = sanitizeConfig(config as any);
    expect(sanitized.$schema).toBe("https://clawrun.sh/schema.json");
  });
});

describe("toEnvVars", () => {
  it("includes core secrets as env vars", () => {
    const config = {
      secrets: {
        cronSecret: "cron-secret-value",
        jwtSecret: "jwt-secret-value",
        sandboxSecret: "sandbox-secret-value",
      },
    };

    const vars = toEnvVars(config as any);

    expect(vars["CLAWRUN_CRON_SECRET"]).toBe("cron-secret-value");
    expect(vars["CLAWRUN_JWT_SECRET"]).toBe("jwt-secret-value");
    expect(vars["CLAWRUN_SANDBOX_SECRET"]).toBe("sandbox-secret-value");
  });

  it("includes per-channel webhook secrets", () => {
    const config = {
      secrets: {
        cronSecret: "c",
        jwtSecret: "j",
        sandboxSecret: "s",
        webhookSecrets: {
          telegram: "tg-secret",
          discord: "dc-secret",
        },
      },
    };

    const vars = toEnvVars(config as any);

    expect(vars["CLAWRUN_WEBHOOK_SECRET_TELEGRAM"]).toBe("tg-secret");
    expect(vars["CLAWRUN_WEBHOOK_SECRET_DISCORD"]).toBe("dc-secret");
  });

  it("uppercases channel names in env var keys", () => {
    const config = {
      secrets: {
        cronSecret: "c",
        jwtSecret: "j",
        sandboxSecret: "s",
        webhookSecrets: { slack: "slack-secret" },
      },
    };

    const vars = toEnvVars(config as any);
    expect(vars["CLAWRUN_WEBHOOK_SECRET_SLACK"]).toBe("slack-secret");
    expect(vars).not.toHaveProperty("CLAWRUN_WEBHOOK_SECRET_slack");
  });

  it("includes REDIS_URL when state is configured", () => {
    const config = {
      secrets: { cronSecret: "c", jwtSecret: "j", sandboxSecret: "s" },
      state: { redisUrl: "redis://localhost:6379" },
    };

    const vars = toEnvVars(config as any);
    expect(vars["REDIS_URL"]).toBe("redis://localhost:6379");
  });

  it("omits REDIS_URL when state is not configured", () => {
    const config = {
      secrets: { cronSecret: "c", jwtSecret: "j", sandboxSecret: "s" },
    };

    const vars = toEnvVars(config as any);
    expect(vars).not.toHaveProperty("REDIS_URL");
  });
});

describe("readConfig / writeConfig", () => {
  const originalHome = process.env.CLAWRUN_HOME;

  beforeEach(() => {
    process.env.CLAWRUN_HOME = TEST_HOME;
    mkdirSync(join(TEST_HOME, "test-instance"), { recursive: true });
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.CLAWRUN_HOME = originalHome;
    } else {
      delete process.env.CLAWRUN_HOME;
    }
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it("readConfig returns null for non-existent instance", () => {
    const result = readConfig("nonexistent");
    expect(result).toBeNull();
  });

  it("readConfig throws on invalid config", () => {
    writeFileSync(
      join(TEST_HOME, "test-instance", "clawrun.json"),
      JSON.stringify({ invalid: true }),
    );
    expect(() => readConfig("test-instance")).toThrow();
  });
});
