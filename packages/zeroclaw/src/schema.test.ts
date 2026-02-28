import { describe, it, expect } from "vitest";
import { validateConfig, safeValidateConfig, configDefaults } from "./schema.js";

describe("configDefaults", () => {
  it("has memory.backend set to sqlite", () => {
    expect(configDefaults.memory?.backend).toBe("sqlite");
  });

  it("has memory.auto_save set to true", () => {
    expect(configDefaults.memory?.auto_save).toBe(true);
  });

  it("has browser.backend set to agent_browser", () => {
    expect(configDefaults.browser?.backend).toBe("agent_browser");
  });

  it("has browser.enabled set to false by default", () => {
    expect(configDefaults.browser?.enabled).toBe(false);
  });

  it("has browser.allowed_domains as empty array by default", () => {
    expect(configDefaults.browser?.allowed_domains).toEqual([]);
  });

  it("has autonomy.level set to supervised by default", () => {
    expect(configDefaults.autonomy?.level).toBe("supervised");
  });

  it("has gateway.port set to 42617 by default", () => {
    expect(configDefaults.gateway?.port).toBe(42617);
  });

  it("has gateway.host set to 127.0.0.1 by default", () => {
    expect(configDefaults.gateway?.host).toBe("127.0.0.1");
  });

  it("has gateway.require_pairing set to true by default", () => {
    expect(configDefaults.gateway?.require_pairing).toBe(true);
  });

  it("has agent.max_tool_iterations set to 20 by default", () => {
    expect(configDefaults.agent?.max_tool_iterations).toBe(20);
  });

  it("does not include properties without schema defaults", () => {
    expect(configDefaults).not.toHaveProperty("api_key");
  });

  it("does not include api_url (no schema default)", () => {
    expect(configDefaults).not.toHaveProperty("api_url");
  });
});

describe("validateConfig", () => {
  it("accepts a valid minimal config with required fields", () => {
    const config = { default_temperature: 0.7 };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("returns the parsed config on valid input", () => {
    const config = { default_temperature: 0.7 };
    const result = validateConfig(config);
    expect(result.default_temperature).toBe(0.7);
  });

  it("throws on invalid config type", () => {
    expect(() => validateConfig("not an object")).toThrow();
  });

  it("throws when default_temperature is missing", () => {
    expect(() => validateConfig({})).toThrow();
  });

  it("accepts config with optional sections", () => {
    const config = {
      default_temperature: 0.7,
      memory: { backend: "sqlite", auto_save: true },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });
});

describe("safeValidateConfig", () => {
  it("returns success true for valid config", () => {
    const result = safeValidateConfig({ default_temperature: 0.7 });
    expect(result.success).toBe(true);
  });

  it("returns data on valid config", () => {
    const result = safeValidateConfig({ default_temperature: 0.7 });
    expect(result.success && result.data.default_temperature).toBe(0.7);
  });

  it("returns success false for invalid config", () => {
    const result = safeValidateConfig("invalid");
    expect(result.success).toBe(false);
  });

  it("returns error on invalid config", () => {
    const result = safeValidateConfig("invalid");
    expect(!result.success && result.error).toBeDefined();
  });

  it("does not throw on invalid config", () => {
    expect(() => safeValidateConfig(null)).not.toThrow();
  });

  it("returns success false when default_temperature is missing", () => {
    const result = safeValidateConfig({});
    expect(result.success).toBe(false);
  });
});
