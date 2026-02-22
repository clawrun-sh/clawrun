import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

export function createNextConfig(overrides?: Partial<NextConfig>): NextConfig {
  // In a pnpm monorepo, the zeroclaw binary resolves through a symlink to
  // packages/zeroclaw/ — outside the default tracing root (packages/app/).
  // Set outputFileTracingRoot to the monorepo root so the binary gets
  // included in the function bundle. Only do this when we're actually in a
  // monorepo (pnpm-workspace.yaml exists two levels up), otherwise the path
  // goes above the project root and breaks standalone deploys.
  const monorepoRoot = join(process.cwd(), "../..");
  const isMonorepo = existsSync(join(monorepoRoot, "pnpm-workspace.yaml"));

  // Include the zeroclaw binary in the function bundle.
  // On Vercel with pnpm, the package may resolve through different paths
  // (app-level symlink, sibling package, or hoisted root node_modules).
  // All paths MUST be relative — absolute paths cause doubled-path errors.
  const binGlob = "dist/bin/**/*";
  const zeroclawBinPaths = [
    // App-level node_modules (pnpm workspace symlink)
    `./node_modules/zeroclaw/${binGlob}`,
  ];

  if (isMonorepo) {
    // Direct sibling path (real location of packages/zeroclaw/)
    zeroclawBinPaths.push(`../zeroclaw/${binGlob}`);
    // Root-level node_modules (Vercel may hoist workspace packages here)
    zeroclawBinPaths.push(`../../node_modules/zeroclaw/${binGlob}`);
  }

  return {
    ...(isMonorepo ? { outputFileTracingRoot: monorepoRoot } : {}),
    transpilePackages: ["@cloudclaw/app", "@cloudclaw/provider"],
    serverExternalPackages: ["grammy", "@vercel/sandbox"],
    outputFileTracingIncludes: {
      "/api/v1/webhook/telegram": zeroclawBinPaths,
      "/api/v1/heartbeat": zeroclawBinPaths,
      "/api/v1/sandbox/restart": zeroclawBinPaths,
    },
    ...overrides,
  };
}
