import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Preset } from "./types.js";
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
 * Collect workspace template files for a preset.
 * Base templates from workspace-templates/ are merged with preset-specific
 * overrides from presets/<id>/workspace/. Preset files take precedence.
 * Returns a map of filename → absolute path.
 */
export function getWorkspaceFiles(presetId: string): Map<string, string> {
  const files = new Map<string, string>();

  // Base templates
  const baseDir = join(repoRoot, "workspace-templates");
  if (existsSync(baseDir)) {
    for (const f of readdirSync(baseDir)) {
      if (f.endsWith(".md")) {
        files.set(f, join(baseDir, f));
      }
    }
  }

  // Preset-specific overrides (takes precedence)
  const presetWorkspaceDir = join(repoRoot, "presets", presetId, "workspace");
  if (existsSync(presetWorkspaceDir)) {
    for (const f of readdirSync(presetWorkspaceDir)) {
      if (f.endsWith(".md")) {
        files.set(f, join(presetWorkspaceDir, f));
      }
    }
  }

  return files;
}
