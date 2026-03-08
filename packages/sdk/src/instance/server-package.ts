import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the path to the installed @clawrun/server package.json.
 *
 * In dev mode (monorepo): resolves via relative path to packages/server.
 * In production: resolves via require.resolve from node_modules.
 */
export function resolveServerPackage(): string {
  // Dev mode: CLI runs from packages/cli/dist/ or packages/sdk/dist/ inside the monorepo
  const repoRoot = resolve(__dirname, "..", "..", "..", "..");
  const monorepoPath = join(repoRoot, "packages", "server", "package.json");
  if (existsSync(monorepoPath)) {
    return monorepoPath;
  }

  // Production: resolve from node_modules (server is a peerDependency, satisfied by CLI)
  const require = createRequire(import.meta.url);
  return require.resolve("@clawrun/server/package.json");
}

/**
 * Get the root directory of the @clawrun/server package.
 */
export function resolveServerDir(): string {
  return dirname(resolveServerPackage());
}

/**
 * Dependencies that must be top-level in a deployed instance for the build to succeed.
 * Reads from the server's own package.json — single source of truth.
 * Filters out workspace: dependencies and @clawrun/ packages (handled separately).
 */
export function getDeployDependencies(): Record<string, string> {
  const serverPkg = JSON.parse(readFileSync(resolveServerPackage(), "utf-8"));
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
