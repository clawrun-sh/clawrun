import { describe, it, expect } from "vitest";
import { validateConfig, safeValidateConfig } from "./schema.js";

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

  it("applies default_temperature when missing", () => {
    const result = validateConfig({});
    expect(result.default_temperature).toBe(0.7);
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

  it("applies defaults when empty object is passed", () => {
    const result = safeValidateConfig({});
    expect(result.success).toBe(true);
    expect(result.success && result.data.default_temperature).toBe(0.7);
  });
});
