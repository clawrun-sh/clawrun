import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { baseWorkspaceDir } from "./workspace.js";

describe("baseWorkspaceDir", () => {
  it("points to an existing directory", () => {
    expect(existsSync(baseWorkspaceDir)).toBe(true);
  });

  it("contains exactly the 7 expected base templates", () => {
    const files = readdirSync(baseWorkspaceDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    expect(files).toEqual([
      "AGENTS.md",
      "BOOTSTRAP.md",
      "HEARTBEAT.md",
      "IDENTITY.md",
      "SOUL.md",
      "TOOLS.md",
      "USER.md",
    ]);
  });

  it("does not contain MEMORY.md (sqlite backend uses memory tools)", () => {
    const files = readdirSync(baseWorkspaceDir);
    expect(files).not.toContain("MEMORY.md");
  });

  it("does not contain non-.md files", () => {
    const files = readdirSync(baseWorkspaceDir);
    for (const f of files) {
      expect(f.endsWith(".md")).toBe(true);
    }
  });
});
