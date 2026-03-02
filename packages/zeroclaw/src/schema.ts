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
 * ZeroClaw's own config defaults, extracted from the JSON schema.
 * Each top-level property with a `default` value is included.
 */
export const schemaDefaults: Partial<ZeroClawConfig> = (() => {
  const props = (rawSchema as Record<string, unknown>).properties as
    | Record<string, { default?: unknown }>
    | undefined;
  if (!props) return {};
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.default !== undefined) {
      defaults[key] = prop.default;
    }
  }
  return defaults as Partial<ZeroClawConfig>;
})();

export type { ZeroClawConfig };
