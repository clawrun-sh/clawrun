import { describe, it, expect } from "vitest";
import { generateDaemonToml } from "./config-generator.js";
import { DAEMON_PORT, DAEMON_HOST } from "./constants.js";
import * as TOML from "@iarna/toml";
import type { Config as ZeroClawConfig } from "./generated/zeroclaw-config.js";

function minimalConfig(): ZeroClawConfig {
  return { default_temperature: 0.7 } as ZeroClawConfig;
}

function parseToml(toml: string): Record<string, unknown> {
  return TOML.parse(toml) as Record<string, unknown>;
}

describe("generateDaemonToml — gateway overrides", () => {
  it("sets gateway.port to DAEMON_PORT", () => {
    const result = parseToml(generateDaemonToml(minimalConfig()));
    expect((result.gateway as Record<string, unknown>).port).toBe(DAEMON_PORT);
  });

  it("sets gateway.host to DAEMON_HOST", () => {
    const result = parseToml(generateDaemonToml(minimalConfig()));
    expect((result.gateway as Record<string, unknown>).host).toBe(DAEMON_HOST);
  });

  it("sets gateway.require_pairing to false", () => {
    const result = parseToml(generateDaemonToml(minimalConfig()));
    expect((result.gateway as Record<string, unknown>).require_pairing).toBe(false);
  });

  it("sets gateway.allow_public_bind to true", () => {
    const result = parseToml(generateDaemonToml(minimalConfig()));
    expect((result.gateway as Record<string, unknown>).allow_public_bind).toBe(true);
  });

  it("overrides user-provided gateway.port", () => {
    const cfg = {
      ...minimalConfig(),
      gateway: { port: 9999, host: "localhost" },
    };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.gateway as Record<string, unknown>).port).toBe(DAEMON_PORT);
  });

  it("overrides user-provided gateway.host", () => {
    const cfg = {
      ...minimalConfig(),
      gateway: { port: 9999, host: "localhost" },
    };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.gateway as Record<string, unknown>).host).toBe(DAEMON_HOST);
  });

  it("preserves extra gateway fields from user config", () => {
    const cfg = {
      ...minimalConfig(),
      gateway: { port: 9999, idempotency_ttl_secs: 120 },
    };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.gateway as Record<string, unknown>).idempotency_ttl_secs).toBe(120);
  });
});

describe("generateDaemonToml — browser overrides", () => {
  it("forces backend to agent_browser when browser is enabled", () => {
    const cfg = {
      ...minimalConfig(),
      browser: { enabled: true, backend: "rust_native" },
    };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.browser as Record<string, unknown>).backend).toBe("agent_browser");
  });

  it("sets allowed_domains to ['*'] when browser is enabled and domains empty", () => {
    const cfg = {
      ...minimalConfig(),
      browser: { enabled: true, allowed_domains: [] },
    };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.browser as Record<string, unknown>).allowed_domains).toEqual(["*"]);
  });

  it("sets allowed_domains to ['*'] when browser is enabled and domains undefined", () => {
    const cfg = { ...minimalConfig(), browser: { enabled: true } };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.browser as Record<string, unknown>).allowed_domains).toEqual(["*"]);
  });

  it("preserves existing allowed_domains when non-empty", () => {
    const cfg = {
      ...minimalConfig(),
      browser: { enabled: true, allowed_domains: ["example.com"] },
    };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.browser as Record<string, unknown>).allowed_domains).toEqual(["example.com"]);
  });

  it("does not modify browser when enabled is false", () => {
    const cfg = {
      ...minimalConfig(),
      browser: { enabled: false, backend: "rust_native" },
    };
    const result = parseToml(generateDaemonToml(cfg as ZeroClawConfig));
    expect((result.browser as Record<string, unknown>).backend).toBe("rust_native");
  });

  it("does not modify browser when browser is undefined", () => {
    const result = parseToml(generateDaemonToml(minimalConfig()));
    expect(result.browser).toBeUndefined();
  });
});

describe("generateDaemonToml — output format", () => {
  it("returns a non-empty string", () => {
    const result = generateDaemonToml(minimalConfig());
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns valid TOML that can be parsed back", () => {
    const result = generateDaemonToml(minimalConfig());
    expect(() => TOML.parse(result)).not.toThrow();
  });

  it("preserves default_temperature in the output", () => {
    const result = parseToml(generateDaemonToml(minimalConfig()));
    expect(result.default_temperature).toBe(0.7);
  });
});

describe("generateDaemonToml — input immutability", () => {
  it("does not mutate the input config object", () => {
    const cfg = {
      ...minimalConfig(),
      gateway: { port: 9999, host: "localhost" },
    };
    const originalPort = cfg.gateway.port;
    generateDaemonToml(cfg as ZeroClawConfig);
    expect(cfg.gateway.port).toBe(originalPort);
  });
});
