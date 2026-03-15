import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePackageVersion, isDevMode } from "./manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read the actual version from a package's package.json on disk. */
function readActualVersion(pkgDir: string): string {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
  return pkg.version;
}

const repoRoot = join(__dirname, "..", "..", "..", "..");

describe("resolvePackageVersion", () => {
  describe("resolves actual package version from node_modules", () => {
    it("@clawrun/logger", () => {
      const expected = readActualVersion(join(repoRoot, "packages", "logger"));
      expect(resolvePackageVersion("@clawrun/logger")).toBe(expected);
    });

    it("@clawrun/agent", () => {
      const expected = readActualVersion(join(repoRoot, "packages", "agent"));
      expect(resolvePackageVersion("@clawrun/agent")).toBe(expected);
    });

    it("@clawrun/agent-zeroclaw", () => {
      const expected = readActualVersion(join(repoRoot, "packages", "agent-zeroclaw"));
      expect(resolvePackageVersion("@clawrun/agent-zeroclaw")).toBe(expected);
    });

    it("@clawrun/provider-vercel", () => {
      const expected = readActualVersion(join(repoRoot, "packages", "provider-vercel"));
      expect(resolvePackageVersion("@clawrun/provider-vercel")).toBe(expected);
    });

    it("@clawrun/sdk", () => {
      const expected = readActualVersion(join(repoRoot, "packages", "sdk"));
      expect(resolvePackageVersion("@clawrun/sdk")).toBe(expected);
    });

    it("zeroclaw (unscoped, version differs from others)", () => {
      const expected = readActualVersion(join(repoRoot, "packages", "zeroclaw"));
      expect(resolvePackageVersion("zeroclaw")).toBe(expected);
    });

    it("@clawrun/server (version differs from others)", () => {
      const expected = readActualVersion(join(repoRoot, "packages", "server"));
      expect(resolvePackageVersion("@clawrun/server")).toBe(expected);
    });

    it("packages with different versions resolve independently", () => {
      const serverVersion = resolvePackageVersion("@clawrun/server");
      const loggerVersion = resolvePackageVersion("@clawrun/logger");
      // server is 0.1.2, logger is 0.1.0 — they must not bleed into each other
      expect(serverVersion).not.toBe(loggerVersion);
    });
  });

  describe("throws for unresolvable packages", () => {
    it("throws for a nonexistent scoped package", () => {
      expect(() => resolvePackageVersion("@clawrun/does-not-exist")).toThrow(
        /Cannot resolve version.*@clawrun\/does-not-exist/,
      );
    });

    it("throws for a nonexistent unscoped package", () => {
      expect(() => resolvePackageVersion("zzz-no-such-pkg-99999")).toThrow(
        /Cannot resolve version/,
      );
    });
  });
});

describe("isDevMode", () => {
  it("returns true when running inside the monorepo", () => {
    expect(isDevMode()).toBe(true);
  });

  it("detection is based on packages/server/package.json existence", () => {
    const serverPkgPath = join(repoRoot, "packages", "server", "package.json");
    expect(() => readFileSync(serverPkgPath)).not.toThrow();
  });
});
