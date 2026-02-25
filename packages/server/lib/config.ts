import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
// Packages that must be loaded from node_modules at runtime (not bundled).
// This ensures a single module instance is shared between the instrumentation
// hook and every route handler — critical for module-level singletons like the
// agent registry and config cache.
const externalPackages = [
  "@vercel/sandbox",
  "@clawrun/runtime",
  "@clawrun/agent",
  "@clawrun/channel",
  "@clawrun/provider",
  "@clawrun/logger",
];

export function createNextConfig(overrides?: Partial<NextConfig>): NextConfig {
  const monorepoRoot = join(process.cwd(), "../..");
  const isMonorepo = existsSync(join(monorepoRoot, "pnpm-workspace.yaml"));

  // Read agent bundle paths from clawrun.json (written by CLI at deploy time).
  let agentBundlePaths: string[] = [];
  const configPath = join(process.cwd(), "clawrun.json");
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    agentBundlePaths = raw.agent?.bundlePaths ?? [];
  }

  const resolvedAgentPaths = agentBundlePaths.map((p) => `./${p}`);

  // Config files that must be bundled with every function.
  const configPaths = ["./clawrun.json", "./agent/config.toml", "./agent/.secret_key"];

  // Sidecar scripts injected into sandbox (daemon supervisor + heartbeat + health).
  const sidecarPaths = [
    "./node_modules/@clawrun/runtime/dist/scripts/sidecar/*",
  ];

  const allPaths = [...resolvedAgentPaths, ...configPaths, ...sidecarPaths];

  return {
    ...(isMonorepo ? { outputFileTracingRoot: monorepoRoot } : {}),
    serverExternalPackages: externalPackages,
    outputFileTracingIncludes: {
      "/": allPaths,
    },
    ...overrides,
  };
}
