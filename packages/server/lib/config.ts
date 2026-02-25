import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
// Packages that must be loaded from node_modules at runtime (not bundled).
// This ensures a single module instance is shared between the instrumentation
// hook and every route handler — critical for module-level singletons like the
// agent registry and config cache.
const externalPackages = [
  "@vercel/sandbox",
  "@cloudclaw/runtime",
  "@cloudclaw/agent",
  "@cloudclaw/channel",
  "@cloudclaw/provider",
  "@cloudclaw/logger",
];

export function createNextConfig(overrides?: Partial<NextConfig>): NextConfig {
  const monorepoRoot = join(process.cwd(), "../..");
  const isMonorepo = existsSync(join(monorepoRoot, "pnpm-workspace.yaml"));

  // Read agent bundle paths from cloudclaw.json (written by CLI at deploy time).
  let agentBundlePaths: string[] = [];
  const configPath = join(process.cwd(), "cloudclaw.json");
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    agentBundlePaths = raw.agent?.bundlePaths ?? [];
  }

  const resolvedAgentPaths = agentBundlePaths.map((p) => `./${p}`);

  // Config files that must be bundled with every function.
  const configPaths = ["./cloudclaw.json", "./agent/config.toml", "./agent/.secret_key"];

  // Extend-loop script injected into sandbox for keep-alive reporting.
  const extendLoopPaths = ["./node_modules/@cloudclaw/runtime/dist/scripts/extend-loop.js"];

  const allPaths = [...resolvedAgentPaths, ...configPaths, ...extendLoopPaths];

  return {
    ...(isMonorepo ? { outputFileTracingRoot: monorepoRoot } : {}),
    serverExternalPackages: externalPackages,
    outputFileTracingIncludes: {
      "/": allPaths,
    },
    ...overrides,
  };
}
