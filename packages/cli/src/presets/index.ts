import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseWorkspaceDir } from "@clawrun/agent";
import type { Preset } from "./types.js";
import { presetSchema } from "./types.js";
import { starter } from "./starter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Navigate from dist/presets/ up to repo root
const repoRoot = join(__dirname, "..", "..", "..", "..");

const presets: Map<string, Preset> = new Map([["starter", starter]]);

export function getPreset(id: string): Preset | undefined {
  return presets.get(id);
}

export function listPresets(): Preset[] {
  return Array.from(presets.values());
}

/**
 * Load and validate a Preset from a folder's preset.json.
 * Returns undefined if no preset.json exists; throws on invalid schema.
 */
export function loadPresetFromDir(dir: string): Preset | undefined {
  const presetJsonPath = join(dir, "preset.json");
  if (!existsSync(presetJsonPath)) return undefined;
  const raw = JSON.parse(readFileSync(presetJsonPath, "utf-8"));
  return presetSchema.parse(raw);
}

/**
 * Register a preset at runtime (e.g. loaded from a user-provided folder).
 */
export function registerPreset(preset: Preset): void {
  presets.set(preset.id, preset);
}

/**
 * Collect workspace template files for a preset.
 *
 * Merge order (later layers override earlier):
 *   1. Base templates from @clawrun/agent workspace-templates/
 *   2. Preset .md files (flat, alongside preset.json)
 *   3. User-provided custom dir (highest priority)
 *
 * Returns a map of filename → absolute path.
 */
export function getWorkspaceFiles(presetId: string, customDir?: string): Map<string, string> {
  const files = new Map<string, string>();

  // Layer 1: Base templates from @clawrun/agent (lowest priority)
  if (existsSync(baseWorkspaceDir)) {
    for (const f of readdirSync(baseWorkspaceDir)) {
      if (f.endsWith(".md")) {
        files.set(f, join(baseWorkspaceDir, f));
      }
    }
  }

  // Layer 2: Preset .md files (flat, alongside preset.json)
  const presetDir = join(repoRoot, "presets", presetId);
  if (existsSync(presetDir)) {
    for (const f of readdirSync(presetDir)) {
      if (f.endsWith(".md")) {
        files.set(f, join(presetDir, f));
      }
    }
  }

  // Layer 3: User-provided custom dir (highest priority)
  // Only pick up .md files that match known workspace template names
  // from base (layer 1) or preset (layer 2) — ignore unrelated .md files.
  if (customDir && existsSync(customDir)) {
    for (const f of readdirSync(customDir)) {
      if (f.endsWith(".md") && files.has(f)) {
        files.set(f, join(customDir, f));
      }
    }
  }

  return files;
}
