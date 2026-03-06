import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProgressCallback } from "@clawrun/provider";
import type { InstanceStep } from "./steps.js";
import {
  DEPLOY_TSCONFIG,
  STALE_PATHS,
  SOURCE_DIRS,
  ROOT_CONFIG_FILES,
  DEPLOY_ONLY_FILES,
  CSS_FIXUPS,
} from "@clawrun/server/deploy-manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the path to the installed @clawrun/server package.json.
 *
 * In dev mode (monorepo): resolves via relative path to packages/server.
 * In production: resolves via require.resolve from node_modules.
 */
function resolveServerPackage(): string {
  // Dev mode: CLI runs from packages/cli/dist/ or packages/sdk/dist/ inside the monorepo
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  const monorepoPath = join(repoRoot, "packages", "server", "package.json");
  if (existsSync(monorepoPath)) {
    return monorepoPath;
  }

  // Production: resolve from node_modules
  const require = createRequire(import.meta.url);
  return require.resolve("@clawrun/server/package.json");
}

/**
 * Copy the server app source into a deployed instance directory.
 *
 * Replaces the old `applyTemplates()` approach. Instead of maintaining a
 * separate templates/ directory with different import paths, we copy
 * app/, lib/, and config files directly from the server package source.
 * Routes use `@/lib/*` imports which resolve via the tsconfig path alias.
 */
export function copyServerApp(
  instancePath: string,
  onProgress?: ProgressCallback<InstanceStep>,
): void {
  const serverPkgJson = resolveServerPackage();
  const serverDir = dirname(serverPkgJson);

  // Remove stale paths from previous versions
  for (const rel of STALE_PATHS) {
    const full = join(instancePath, rel);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
    }
  }

  // Copy source directories
  for (const dir of SOURCE_DIRS) {
    cpSync(join(serverDir, dir), join(instancePath, dir), { recursive: true, force: true });
  }

  // Copy deploy-only files
  for (const [src, dest] of Object.entries(DEPLOY_ONLY_FILES)) {
    cpSync(join(serverDir, src), join(instancePath, dest));
  }

  // Copy root config files
  for (const file of ROOT_CONFIG_FILES) {
    const src = join(serverDir, file);
    if (existsSync(src)) {
      cpSync(src, join(instancePath, file));
    }
  }

  // Apply CSS fixups for monorepo → deployed layout transition
  const globalsCssPath = join(instancePath, "app", "globals.css");
  if (existsSync(globalsCssPath)) {
    let css = readFileSync(globalsCssPath, "utf-8");
    for (const { pattern, replacement } of CSS_FIXUPS) {
      css = css.replace(pattern, replacement);
    }
    writeFileSync(globalsCssPath, css);
  }

  // Write deployment tsconfig.json (standalone — no monorepo extends)
  writeFileSync(
    join(instancePath, "tsconfig.json"),
    JSON.stringify(DEPLOY_TSCONFIG, null, 2) + "\n",
  );

  // Stamp server version into the instance's package.json
  const serverPkg = JSON.parse(readFileSync(serverPkgJson, "utf-8"));
  const instancePkgPath = join(instancePath, "package.json");
  if (existsSync(instancePkgPath)) {
    const instancePkg = JSON.parse(readFileSync(instancePkgPath, "utf-8"));
    instancePkg.version = serverPkg.version;
    writeFileSync(instancePkgPath, JSON.stringify(instancePkg, null, 2) + "\n");
  }

  onProgress?.({ step: "copy-server-app", message: "Server app copied." });
}
