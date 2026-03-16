import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Preset } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build step copies ../../presets/ into dist/presets/
// So dist/presets/starter.js sits alongside dist/presets/starter/preset.json
const presetPath = join(__dirname, "starter", "preset.json");

export const starter: Preset = JSON.parse(readFileSync(presetPath, "utf-8"));
