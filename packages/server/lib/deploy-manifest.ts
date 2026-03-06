import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

/**
 * Dependencies that must be top-level in a deployed instance for the build to succeed.
 * Read from the server's own package.json — single source of truth.
 */
export function getDeployDependencies(): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const [name, version] of Object.entries(serverPkg.dependencies ?? {})) {
    if (
      typeof version === "string" &&
      !version.startsWith("workspace:") &&
      !name.startsWith("@clawrun/")
    ) {
      deps[name] = version;
    }
  }
  for (const [name, version] of Object.entries(serverPkg.devDependencies ?? {})) {
    if (
      typeof version === "string" &&
      !version.startsWith("workspace:") &&
      !name.startsWith("@clawrun/")
    ) {
      deps[name] = version;
    }
  }
  return deps;
}

/**
 * Deployment tsconfig.json — standalone (no extends to monorepo packages).
 * Includes the @/* path alias so `@/lib/*` imports resolve correctly.
 */
export const DEPLOY_TSCONFIG = {
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

/**
 * Paths from previous template versions that should be cleaned up on upgrade.
 */
export const STALE_PATHS = [
  "app/api/auth",
  "app/auth/signin",
  "node-stub.js",
  "middleware.ts",
  "templates",
];

/** Build cache directory to clean on upgrade. */
export const BUILD_CACHE_DIR = ".next";

/** Source directories to copy from server package into deployed instance. */
export const SOURCE_DIRS = ["app", "lib"];

/** Root config files to copy from server package. */
export const ROOT_CONFIG_FILES = ["proxy.ts", "next.config.ts", "postcss.config.mjs"];

/**
 * Deploy-only files: source path (relative to server root) → destination path (relative to instance root).
 * Stored outside the server's app root so the framework doesn't auto-detect them.
 */
export const DEPLOY_ONLY_FILES: Record<string, string> = {
  "deploy/instrumentation.ts": "instrumentation.ts",
};

/** CSS path fixups for monorepo → deployed layout transition. */
export const CSS_FIXUPS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /@source\s+"\.\.\/\.\.\/ui\/src"/g,
    replacement: '@source "../node_modules/@clawrun/ui/src"',
  },
  {
    pattern: /@source\s+"\.\.\/\.\.\/ui\/node_modules\/streamdown\/dist"/g,
    replacement: '@source "../node_modules/streamdown/dist"',
  },
];
