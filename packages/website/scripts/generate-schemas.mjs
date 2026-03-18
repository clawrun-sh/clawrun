#!/usr/bin/env node

/**
 * Generate JSON Schema files from Zod schemas in @clawrun/runtime and @clawrun/sdk.
 * Writes to public/ so Next.js serves them as static files.
 *
 * Run: node scripts/generate-schemas.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// Resolve zod from the runtime package's node_modules (pnpm may hoist it)
const runtimeDir = join(__dirname, "..", "..", "runtime");
const runtimeRequire = createRequire(join(runtimeDir, "package.json"));
const zodPath = runtimeRequire.resolve("zod");
const { z } = await import(zodPath);

const { clawRunConfigSchema } = await import(
  join(runtimeDir, "dist", "schema.js")
);
const { presetSchema } = await import(
  join(__dirname, "..", "..", "sdk", "dist", "presets", "types.js")
);

// --- clawrun.json schema ---
const configSchema = z.toJSONSchema(clawRunConfigSchema, {
  target: "draft-2020-12",
});
configSchema.title = "ClawRun Instance Configuration";
configSchema.description =
  "Configuration for a deployed ClawRun agent instance (clawrun.json).";

writeFileSync(
  join(publicDir, "schema.json"),
  JSON.stringify(configSchema, null, 2) + "\n",
);
console.log(
  `  schema.json: ${Object.keys(configSchema.properties).length} properties`,
);

// --- preset.json schema ---
const presetJsonSchema = z.toJSONSchema(presetSchema, {
  target: "draft-2020-12",
});
presetJsonSchema.title = "ClawRun Preset";
presetJsonSchema.description =
  "Preset definition for a ClawRun agent deployment (preset.json).";

mkdirSync(join(publicDir, "preset"), { recursive: true });
writeFileSync(
  join(publicDir, "preset", "schema.json"),
  JSON.stringify(presetJsonSchema, null, 2) + "\n",
);
console.log(
  `  preset/schema.json: ${Object.keys(presetJsonSchema.properties).length} properties`,
);
