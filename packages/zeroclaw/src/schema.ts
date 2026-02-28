import { z } from "zod";
import rawSchema from "./zeroclaw-config.schema.json" with { type: "json" };
import type { Config as ZeroClawConfig } from "./generated/zeroclaw-config.js";

// Runtime validator from JSON Schema (Draft 2020-12, schemars-derived).
// `unknown` intermediate cast: Zod's JSONSchema type models `type` as a single
// string literal, but Draft 2020-12 allows arrays (e.g. ["string", "null"]).
// The runtime function handles both — the mismatch is in Zod's type defs.
type FromJSONSchemaInput = Parameters<typeof z.fromJSONSchema>[0];
const validator = z.fromJSONSchema(rawSchema as unknown as FromJSONSchemaInput);

/** Validate a parsed config object against ZeroClaw's schema. Throws on invalid. */
export function validateConfig(config: unknown): ZeroClawConfig {
  return validator.parse(config) as ZeroClawConfig;
}

/** Validate without throwing. Returns success/error result. */
export function safeValidateConfig(config: unknown) {
  const result = validator.safeParse(config);
  return result.success
    ? { success: true as const, data: result.data as ZeroClawConfig }
    : { success: false as const, error: result.error };
}

/**
 * Default values for every config section, extracted from the JSON Schema's
 * `default` annotations. These are the values ZeroClaw uses when a section
 * is absent from config.toml (via `#[serde(default)]`).
 *
 * Use this to avoid hard-coding defaults that duplicate ZeroClaw's own.
 */
export const configDefaults: Partial<ZeroClawConfig> = Object.fromEntries(
  Object.entries(rawSchema.properties)
    .filter(([, v]) => "default" in v)
    .map(([k, v]) => [k, (v as { default: unknown }).default]),
) as Partial<ZeroClawConfig>;

export type { ZeroClawConfig };
