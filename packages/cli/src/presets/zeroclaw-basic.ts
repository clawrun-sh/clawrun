import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Preset } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Navigate from dist/presets/ up to repo root, then into presets/
const presetPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "presets",
  "zeroclaw-basic",
  "preset.json",
);

export const zeroclawBasic: Preset = JSON.parse(readFileSync(presetPath, "utf-8"));
