import { describe, it, expect } from "vitest";
import { presetSchema, PRESET_SCHEMA_URL } from "./types.js";

const validPreset = {
  id: "test",
  name: "Test Preset",
  agent: "zeroclaw",
  provider: "vercel",
  description: "A test preset",
};

describe("presetSchema — valid inputs", () => {
  it("accepts a minimal valid preset", () => {
    const result = presetSchema.parse(validPreset);
    expect(result.id).toBe("test");
    expect(result.name).toBe("Test Preset");
    expect(result.agent).toBe("zeroclaw");
    expect(result.provider).toBe("vercel");
    expect(result.description).toBe("A test preset");
  });

  it("accepts $schema as an optional field", () => {
    const result = presetSchema.parse({
      $schema: PRESET_SCHEMA_URL,
      ...validPreset,
    });
    expect(result.$schema).toBe(PRESET_SCHEMA_URL);
  });

  it("accepts preset without $schema", () => {
    const result = presetSchema.parse(validPreset);
    expect(result.$schema).toBeUndefined();
  });
});

describe("presetSchema — missing required fields", () => {
  it("rejects preset missing id", () => {
    const { id: _, ...rest } = validPreset;
    expect(() => presetSchema.parse(rest)).toThrow();
  });

  it("rejects preset missing name", () => {
    const { name: _, ...rest } = validPreset;
    expect(() => presetSchema.parse(rest)).toThrow();
  });

  it("rejects preset missing agent", () => {
    const { agent: _, ...rest } = validPreset;
    expect(() => presetSchema.parse(rest)).toThrow();
  });

  it("rejects preset missing provider", () => {
    const { provider: _, ...rest } = validPreset;
    expect(() => presetSchema.parse(rest)).toThrow();
  });

  it("rejects preset missing description", () => {
    const { description: _, ...rest } = validPreset;
    expect(() => presetSchema.parse(rest)).toThrow();
  });
});

describe("presetSchema — wrong types", () => {
  it("rejects numeric id", () => {
    expect(() => presetSchema.parse({ ...validPreset, id: 123 })).toThrow();
  });

  it("rejects null provider", () => {
    expect(() => presetSchema.parse({ ...validPreset, provider: null })).toThrow();
  });

  it("rejects empty object", () => {
    expect(() => presetSchema.parse({})).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => presetSchema.parse("starter")).toThrow();
  });
});

describe("presetSchema — extra fields", () => {
  it("strips unknown fields", () => {
    const result = presetSchema.parse({ ...validPreset, extra: "stuff" });
    expect(result).not.toHaveProperty("extra");
  });
});
