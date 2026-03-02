import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Paths that existed in previous template versions but have since been removed.
 * Cleaned up before applying new server source so stale routes don't cause build errors.
 */
const STALE_PATHS = [
  "app/api/auth",
  "app/auth/signin",
  "node-stub.js",
  "middleware.ts",
  // Old template artifacts that no longer exist in the source-copy model
  "templates",
];

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

/**
 * Vercel deployment config — crons, regions, function durations.
 */
const VERCEL_JSON = {
  framework: "nextjs",
  regions: ["iad1"],
  crons: [{ path: "/api/v1/heartbeat", schedule: "* * * * *" }],
  functions: {
    "app/api/v1/**/*.ts": {
      maxDuration: 60,
    },
  },
};

/**
 * Resolve the path to the installed @clawrun/server package.json.
 *
 * In dev mode (monorepo): resolves via relative path to packages/server.
 * In production: resolves via require.resolve from node_modules.
 */
function resolveServerPackage(): string {
  // Dev mode: CLI runs from packages/cli/dist/ inside the monorepo
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
export function copyServerApp(instancePath: string): void {
  const serverPkgJson = resolveServerPackage();
  const serverDir = dirname(serverPkgJson);

  // Remove stale paths from previous versions
  for (const rel of STALE_PATHS) {
    const full = join(instancePath, rel);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
    }
  }

  // Copy app/ and lib/ directories
  cpSync(join(serverDir, "app"), join(instancePath, "app"), { recursive: true, force: true });
  cpSync(join(serverDir, "lib"), join(instancePath, "lib"), { recursive: true, force: true });

  // Copy deploy-only files (stored outside server root so Next.js doesn't auto-detect them)
  cpSync(join(serverDir, "deploy", "instrumentation.ts"), join(instancePath, "instrumentation.ts"));

  // Copy root config files
  for (const file of ["proxy.ts", "next.config.ts", "postcss.config.mjs"]) {
    const src = join(serverDir, file);
    if (existsSync(src)) {
      cpSync(src, join(instancePath, file));
    }
  }

  // Rewrite @source paths in globals.css for deployed instances.
  // In the monorepo, node_modules/@clawrun/ui is a symlink to ../../ui,
  // so the same ../node_modules/ paths work in both environments.
  // But just in case the dev CSS has monorepo-relative paths, normalize them.
  const globalsCssPath = join(instancePath, "app", "globals.css");
  if (existsSync(globalsCssPath)) {
    let css = readFileSync(globalsCssPath, "utf-8");
    // Normalize any monorepo-relative UI path to node_modules path
    css = css.replace(
      /@source\s+"\.\.\/\.\.\/ui\/src"/g,
      '@source "../node_modules/@clawrun/ui/src"',
    );
    css = css.replace(
      /@source\s+"\.\.\/\.\.\/ui\/node_modules\/streamdown\/dist"/g,
      '@source "../node_modules/streamdown/dist"',
    );
    writeFileSync(globalsCssPath, css);
  }

  // Write deployment tsconfig.json (standalone — no monorepo extends)
  writeFileSync(
    join(instancePath, "tsconfig.json"),
    JSON.stringify(DEPLOY_TSCONFIG, null, 2) + "\n",
  );

  // Write vercel.json
  writeFileSync(join(instancePath, "vercel.json"), JSON.stringify(VERCEL_JSON, null, 2) + "\n");

  // Stamp server version into the instance's package.json
  const serverPkg = JSON.parse(readFileSync(serverPkgJson, "utf-8"));
  const instancePkgPath = join(instancePath, "package.json");
  if (existsSync(instancePkgPath)) {
    const instancePkg = JSON.parse(readFileSync(instancePkgPath, "utf-8"));
    instancePkg.version = serverPkg.version;
    writeFileSync(instancePkgPath, JSON.stringify(instancePkg, null, 2) + "\n");
  }

  clack.log.success("Server app copied.");
}
