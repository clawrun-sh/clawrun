import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// --- helpers ---

let tempBase: string;

function makeTempDir(name: string): string {
  const dir = join(tempBase, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMd(dir: string, filename: string, content = ""): void {
  writeFileSync(join(dir, filename), content || `# ${filename}`);
}

function writePresetJson(dir: string, preset: Record<string, unknown>): void {
  writeFileSync(join(dir, "preset.json"), JSON.stringify(preset));
}

// --- setup ---

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), "presets-test-"));
  vi.resetModules();
});

afterEach(() => {
  rmSync(tempBase, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ============================================================
// getWorkspaceFiles — 3-layer merge
// ============================================================

describe("getWorkspaceFiles — layer merge logic", () => {
  it("returns base templates for a non-existent preset id", async () => {
    // Mock baseWorkspaceDir to a temp dir with known files
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "BOOTSTRAP.md", "# base bootstrap");
    writeMd(baseDir, "SOUL.md", "# base soul");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent-preset");
    expect(files.size).toBe(2);
    expect(files.has("BOOTSTRAP.md")).toBe(true);
    expect(files.has("SOUL.md")).toBe(true);
    // Paths should point to base dir
    expect(files.get("BOOTSTRAP.md")).toBe(join(baseDir, "BOOTSTRAP.md"));
  });

  it("preset .md files override base templates with same name", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "AGENTS.md", "# base agents");
    writeMd(baseDir, "SOUL.md", "# base soul");

    // Create a preset dir in the expected location
    const presetsRoot = makeTempDir("presets-root");
    const presetDir = join(presetsRoot, "presets", "mypreset");
    mkdirSync(presetDir, { recursive: true });
    writeMd(presetDir, "AGENTS.md", "# preset agents override");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    // Need to also mock the repoRoot derivation. Since we can't easily control
    // __dirname, we test via the customDir layer instead (layer 3 overriding layer 1).
    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    // Use customDir as the override layer
    const files = getWorkspaceFiles("nonexistent", presetDir);
    // AGENTS.md should come from customDir (presetDir), SOUL.md from base
    expect(files.get("AGENTS.md")).toBe(join(presetDir, "AGENTS.md"));
    expect(files.get("SOUL.md")).toBe(join(baseDir, "SOUL.md"));
  });

  it("custom dir overrides base files but ignores unknown .md files", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "BOOTSTRAP.md", "# base");
    writeMd(baseDir, "SOUL.md", "# base soul");

    const customDir = makeTempDir("custom");
    writeMd(customDir, "BOOTSTRAP.md", "# custom bootstrap");
    writeMd(customDir, "CUSTOM.md", "# extra custom file — not a known template");
    writeMd(customDir, "README.md", "# readme — not a workspace file");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent", customDir);
    // BOOTSTRAP.md overridden by custom
    expect(files.get("BOOTSTRAP.md")).toBe(join(customDir, "BOOTSTRAP.md"));
    // SOUL.md from base (no custom override)
    expect(files.get("SOUL.md")).toBe(join(baseDir, "SOUL.md"));
    // CUSTOM.md and README.md are NOT picked up — not known workspace templates
    expect(files.has("CUSTOM.md")).toBe(false);
    expect(files.has("README.md")).toBe(false);
    expect(files.size).toBe(2);
  });

  it("ignores non-.md files in all layers", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "BOOTSTRAP.md");
    writeMd(baseDir, "SOUL.md");
    writeFileSync(join(baseDir, "preset.json"), "{}");
    writeFileSync(join(baseDir, "config.toml"), "key=1");
    writeFileSync(join(baseDir, "notes.txt"), "some notes");

    const customDir = makeTempDir("custom");
    writeMd(customDir, "SOUL.md");
    writeFileSync(join(customDir, "data.json"), "{}");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent", customDir);
    for (const [filename] of files) {
      expect(filename.endsWith(".md")).toBe(true);
    }
    expect(files.has("BOOTSTRAP.md")).toBe(true);
    expect(files.has("SOUL.md")).toBe(true);
    expect(files.size).toBe(2);
  });

  it("returns empty map when no directories exist", async () => {
    // Point to a non-existent base dir
    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent/path/that/does/not/exist",
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("also-nonexistent");
    expect(files.size).toBe(0);
  });

  it("works with undefined customDir", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "SOUL.md");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent", undefined);
    expect(files.has("SOUL.md")).toBe(true);
  });

  it("handles customDir pointing to non-existent path gracefully", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "SOUL.md");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent", "/does/not/exist");
    // Should still return base files
    expect(files.has("SOUL.md")).toBe(true);
    expect(files.size).toBe(1);
  });

  it("custom dir overrides only matching files, rest falls back to base", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "AGENTS.md");
    writeMd(baseDir, "BOOTSTRAP.md");
    writeMd(baseDir, "HEARTBEAT.md");
    writeMd(baseDir, "IDENTITY.md");
    writeMd(baseDir, "MEMORY.md");
    writeMd(baseDir, "SOUL.md");
    writeMd(baseDir, "TOOLS.md");
    writeMd(baseDir, "USER.md");

    const customDir = makeTempDir("my-agent");
    // User overrides 2 files, has 2 unrelated files
    writeMd(customDir, "SOUL.md", "# my custom soul");
    writeMd(customDir, "AGENTS.md", "# my custom agents");
    writeMd(customDir, "README.md", "# unrelated");
    writeMd(customDir, "CLAUDE.md", "# unrelated");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");
    const files = getWorkspaceFiles("nonexistent", customDir);

    // Total count = base count (8), no new files added from custom
    expect(files.size).toBe(8);

    // Overridden files come from custom dir
    expect(files.get("SOUL.md")).toBe(join(customDir, "SOUL.md"));
    expect(files.get("AGENTS.md")).toBe(join(customDir, "AGENTS.md"));

    // Everything else falls back to base
    expect(files.get("BOOTSTRAP.md")).toBe(join(baseDir, "BOOTSTRAP.md"));
    expect(files.get("HEARTBEAT.md")).toBe(join(baseDir, "HEARTBEAT.md"));
    expect(files.get("IDENTITY.md")).toBe(join(baseDir, "IDENTITY.md"));
    expect(files.get("MEMORY.md")).toBe(join(baseDir, "MEMORY.md"));
    expect(files.get("TOOLS.md")).toBe(join(baseDir, "TOOLS.md"));
    expect(files.get("USER.md")).toBe(join(baseDir, "USER.md"));

    // Unrelated files are excluded
    expect(files.has("README.md")).toBe(false);
    expect(files.has("CLAUDE.md")).toBe(false);
  });
});

// ============================================================
// getWorkspaceFiles — resolved source filtering (used by deploy)
// ============================================================

describe("getWorkspaceFiles — identifying files from custom dir", () => {
  it("only known template overrides from custom dir resolve to custom dir path", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "BOOTSTRAP.md", "# base");
    writeMd(baseDir, "SOUL.md", "# base soul");
    writeMd(baseDir, "IDENTITY.md", "# base identity");

    const customDir = makeTempDir("custom");
    // Override one base file, also has an unknown file
    writeMd(customDir, "SOUL.md", "# custom soul override");
    writeMd(customDir, "README.md", "# not a workspace template");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent", customDir);

    // Filter to only files sourced from customDir
    const fromCustom = [...files.entries()]
      .filter(([, srcPath]) => dirname(srcPath) === customDir)
      .map(([filename]) => filename);

    // Only SOUL.md (known override) — README.md is not a known template
    expect(fromCustom).toContain("SOUL.md");
    expect(fromCustom).toHaveLength(1);

    // BOOTSTRAP.md and IDENTITY.md should come from base, not custom
    expect(files.get("BOOTSTRAP.md")).toBe(join(baseDir, "BOOTSTRAP.md"));
    expect(files.get("IDENTITY.md")).toBe(join(baseDir, "IDENTITY.md"));
    // README.md should not be in the map at all
    expect(files.has("README.md")).toBe(false);
  });

  it("does not misattribute base files when custom dir is an ancestor of base dir", async () => {
    // Simulates `clawrun deploy .` from repo root — customDir is parent of baseDir
    const rootDir = makeTempDir("repo-root");
    const baseDir = join(rootDir, "packages", "agent", "workspace-templates");
    mkdirSync(baseDir, { recursive: true });
    writeMd(baseDir, "BOOTSTRAP.md", "# base");
    writeMd(baseDir, "SOUL.md", "# base soul");

    // rootDir has no .md files that match templates — only unrelated ones
    writeMd(rootDir, "README.md", "# project readme");
    writeMd(rootDir, "CLAUDE.md", "# claude instructions");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent", rootDir);

    // Filter using dirname — same logic deploy.ts uses
    const fromCustom = [...files.entries()]
      .filter(([, srcPath]) => dirname(srcPath) === rootDir)
      .map(([filename]) => filename);

    // No files should be attributed to rootDir — base files live in a subdirectory
    expect(fromCustom).toHaveLength(0);
    // Base files should still be present
    expect(files.has("BOOTSTRAP.md")).toBe(true);
    expect(files.has("SOUL.md")).toBe(true);
  });

  it("base-only files are not attributed to custom dir", async () => {
    const baseDir = makeTempDir("base");
    writeMd(baseDir, "BOOTSTRAP.md");
    writeMd(baseDir, "TOOLS.md");

    const customDir = makeTempDir("custom-empty");
    // Custom dir has no .md files

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: baseDir,
    }));

    const { getWorkspaceFiles } = await import("@clawrun/sdk");

    const files = getWorkspaceFiles("nonexistent", customDir);

    const fromCustom = [...files.entries()]
      .filter(([, srcPath]) => dirname(srcPath) === customDir)
      .map(([filename]) => filename);

    expect(fromCustom).toHaveLength(0);
    expect(files.size).toBe(2);
  });
});

// ============================================================
// loadPresetFromDir
// ============================================================

describe("loadPresetFromDir", () => {
  it("returns undefined when directory has no preset.json", async () => {
    const dir = makeTempDir("no-preset");
    writeMd(dir, "SOUL.md");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { loadPresetFromDir } = await import("@clawrun/sdk");
    expect(loadPresetFromDir(dir)).toBeUndefined();
  });

  it("parses and returns a valid preset.json", async () => {
    const dir = makeTempDir("valid-preset");
    writePresetJson(dir, {
      id: "custom",
      name: "Custom",
      agent: "zeroclaw",
      provider: "vercel",
      description: "Custom preset",
    });

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { loadPresetFromDir } = await import("@clawrun/sdk");
    const result = loadPresetFromDir(dir);
    expect(result).toBeDefined();
    expect(result!.id).toBe("custom");
    expect(result!.agent).toBe("zeroclaw");
    expect(result!.provider).toBe("vercel");
  });

  it("accepts preset.json with $schema field", async () => {
    const dir = makeTempDir("schema-preset");
    writePresetJson(dir, {
      $schema: "https://clawrun.sh/preset/schema.json",
      id: "with-schema",
      name: "With Schema",
      agent: "zeroclaw",
      provider: "vercel",
      description: "Has $schema",
    });

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { loadPresetFromDir } = await import("@clawrun/sdk");
    const result = loadPresetFromDir(dir);
    expect(result).toBeDefined();
    expect(result!.$schema).toBe("https://clawrun.sh/preset/schema.json");
    expect(result!.id).toBe("with-schema");
  });

  it("throws on invalid preset.json (missing required fields)", async () => {
    const dir = makeTempDir("invalid-preset");
    writePresetJson(dir, {
      id: "incomplete",
      // missing name, agent, provider, description
    });

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { loadPresetFromDir } = await import("@clawrun/sdk");
    expect(() => loadPresetFromDir(dir)).toThrow();
  });

  it("throws on malformed JSON", async () => {
    const dir = makeTempDir("bad-json");
    writeFileSync(join(dir, "preset.json"), "{ not valid json }");

    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { loadPresetFromDir } = await import("@clawrun/sdk");
    expect(() => loadPresetFromDir(dir)).toThrow();
  });
});

// ============================================================
// registerPreset / getPreset / listPresets
// ============================================================

describe("preset registry", () => {
  it("getPreset returns the built-in starter preset", async () => {
    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { getPreset } = await import("@clawrun/sdk");
    const preset = getPreset("starter");
    expect(preset).toBeDefined();
    expect(preset!.id).toBe("starter");
    expect(preset!.agent).toBe("zeroclaw");
  });

  it("getPreset returns undefined for unknown id", async () => {
    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { getPreset } = await import("@clawrun/sdk");
    expect(getPreset("unknown")).toBeUndefined();
  });

  it("registerPreset makes the preset available via getPreset", async () => {
    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { registerPreset, getPreset } = await import("@clawrun/sdk");

    const custom = {
      id: "custom",
      name: "Custom",
      agent: "nanobot",
      provider: "vercel" as const,
      description: "custom preset",
    };
    registerPreset(custom);

    const result = getPreset("custom");
    expect(result).toBeDefined();
    expect(result!.agent).toBe("nanobot");
    expect(result!.provider).toBe("vercel");
  });

  it("registerPreset overwrites an existing preset with same id", async () => {
    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { registerPreset, getPreset } = await import("@clawrun/sdk");

    registerPreset({
      id: "starter",
      name: "Starter V2",
      agent: "zeroclaw",
      provider: "vercel",
      description: "overridden",
    });

    const result = getPreset("starter");
    expect(result!.name).toBe("Starter V2");
    expect(result!.description).toBe("overridden");
  });

  it("listPresets returns all registered presets", async () => {
    vi.doMock("@clawrun/agent", () => ({
      baseWorkspaceDir: "/nonexistent",
    }));

    const { registerPreset, listPresets } = await import("@clawrun/sdk");

    // Initially should have at least "starter"
    const initial = listPresets();
    expect(initial.length).toBeGreaterThanOrEqual(1);
    expect(initial.some((p) => p.id === "starter")).toBe(true);

    registerPreset({
      id: "second",
      name: "Second",
      agent: "x",
      provider: "vercel" as const,
      description: "d",
    });

    const after = listPresets();
    expect(after.length).toBe(initial.length + 1);
    expect(after.some((p) => p.id === "second")).toBe(true);
  });
});
