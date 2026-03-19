import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProgressCallback } from "@clawrun/provider";
import type { InstanceStep } from "./steps.js";
import { resolveServerPackage } from "./server-package.js";

/**
 * Deployment tsconfig.json — standalone (no extends to monorepo packages).
 * Includes the @/* path alias so `@/lib/*` imports resolve correctly.
 */
const DEPLOY_TSCONFIG = {
  compilerOptions: {
    target: "ES2017",
    lib: ["dom", "dom.iterable", "esnext"],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: "esnext",
    moduleResolution: "bundler",
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: "preserve",
    incremental: true,
    plugins: [{ name: "next" }],
    paths: { "@/*": ["./*"] },
  },
  include: ["**/*.ts", "**/*.tsx", "next-env.d.ts", ".next/types/**/*.ts"],
  exclude: ["node_modules"],
};

/** Paths from previous template versions that should be cleaned up on upgrade. */
const STALE_PATHS = [
  "app/api/auth",
  "app/auth/signin",
  "app/chat",
  "app/page.tsx",
  "node-stub.js",
  "middleware.ts",
  "templates",
];

/** Source directories to copy from server package into deployed instance. */
const SOURCE_DIRS = ["app", "lib", "public"];

/** Root config files to copy from server package. */
const ROOT_CONFIG_FILES = ["proxy.ts", "next.config.ts", "postcss.config.mjs"];

/**
 * Deploy-only files: source path (relative to server root) → destination path (relative to instance root).
 * Stored outside the server's app root so the framework doesn't auto-detect them.
 */
const DEPLOY_ONLY_FILES: Record<string, string> = {
  "deploy/instrumentation.ts": "instrumentation.ts",
  "deploy/instrumentation-node.ts": "instrumentation-node.ts",
};

/** CSS path fixups for monorepo → deployed layout transition. */
const CSS_FIXUPS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /@import\s+"\.\.\/\.\.\/ui\/src\/styles\/globals\.css"/g,
    replacement: '@import "../node_modules/@clawrun/ui/src/styles/globals.css"',
  },
  {
    pattern: /@source\s+"\.\.\/\.\.\/ui\/src"/g,
    replacement: '@source "../node_modules/@clawrun/ui/src"',
  },
  {
    pattern: /@source\s+"\.\.\/\.\.\/ui\/node_modules\/streamdown\/dist"/g,
    replacement: '@source "../node_modules/streamdown/dist"',
  },
];

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
  const serverPkgPath = resolveServerPackage();
  const serverDir = dirname(serverPkgPath);

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
  const serverPkg = JSON.parse(readFileSync(serverPkgPath, "utf-8"));
  const instancePkgPath = join(instancePath, "package.json");
  if (existsSync(instancePkgPath)) {
    const instancePkg = JSON.parse(readFileSync(instancePkgPath, "utf-8"));
    instancePkg.version = serverPkg.version;
    writeFileSync(instancePkgPath, JSON.stringify(instancePkg, null, 2) + "\n");
  }

  onProgress?.({ step: "copy-server-app", message: "Server app copied." });
}
