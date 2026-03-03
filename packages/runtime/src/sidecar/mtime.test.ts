import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getMaxMtime } from "./mtime.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `mtime-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("getMaxMtime", () => {
  it("returns 0 for empty directory", () => {
    expect(getMaxMtime(testDir, [])).toBe(0);
  });

  it("returns mtime of single file", () => {
    const filePath = join(testDir, "file.txt");
    writeFileSync(filePath, "hello");
    const mtime = getMaxMtime(testDir, []);
    expect(mtime).toBeGreaterThan(0);
  });

  it("returns highest mtime across multiple files", () => {
    const oldFile = join(testDir, "old.txt");
    const newFile = join(testDir, "new.txt");
    writeFileSync(oldFile, "old");
    // Set old file to a known past time
    const past = new Date("2020-01-01");
    utimesSync(oldFile, past, past);
    writeFileSync(newFile, "new");

    const mtime = getMaxMtime(testDir, []);
    // Should match the newer file, not the old one
    expect(mtime).toBeGreaterThan(past.getTime());
  });

  it("recurses into subdirectories", () => {
    const subDir = join(testDir, "sub");
    mkdirSync(subDir);
    const deepFile = join(subDir, "deep.txt");
    writeFileSync(deepFile, "deep");

    const mtime = getMaxMtime(testDir, []);
    expect(mtime).toBeGreaterThan(0);
  });

  it("ignores files in ignore list", () => {
    const kept = join(testDir, "keep.txt");
    const ignored = join(testDir, "node_modules");
    writeFileSync(kept, "keep");
    // Set kept file to a known time
    const knownTime = new Date("2023-06-15");
    utimesSync(kept, knownTime, knownTime);

    mkdirSync(ignored);
    const deepIgnored = join(ignored, "pkg.json");
    writeFileSync(deepIgnored, "ignored");
    // Set ignored file to a NEWER time
    const future = new Date("2025-01-01");
    utimesSync(deepIgnored, future, future);

    const mtime = getMaxMtime(testDir, ["node_modules"]);
    // Should match kept file time, not the newer ignored file
    expect(Math.abs(mtime - knownTime.getTime())).toBeLessThan(1000);
  });

  it("handles non-existent directory without throwing", () => {
    const result = getMaxMtime("/tmp/definitely-does-not-exist-abc123", []);
    expect(result).toBe(0);
  });

  it("ignores files by exact name (not pattern)", () => {
    writeFileSync(join(testDir, ".git"), "git");
    writeFileSync(join(testDir, "other.txt"), "other");
    const past = new Date("2020-01-01");
    utimesSync(join(testDir, "other.txt"), past, past);
    const future = new Date("2099-01-01");
    utimesSync(join(testDir, ".git"), future, future);

    const mtime = getMaxMtime(testDir, [".git"]);
    expect(mtime).toBeLessThan(future.getTime());
  });
});
