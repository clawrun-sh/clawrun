import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
// Core packages that must be loaded from node_modules at runtime (not bundled).
// This ensures a single module instance is shared between the instrumentation
// hook and every route handler — critical for module-level singletons like the
// agent registry and config cache.
// Implementation-specific packages (agent-*, provider-*, SDK deps) are added
// dynamically from clawrun.json inside createNextConfig().
const coreExternalPackages = [
  "@clawrun/runtime",
  "@clawrun/agent",
  "@clawrun/channel",
  "@clawrun/provider",
  "@clawrun/logger",
];

export function createNextConfig(overrides?: Partial<NextConfig>): NextConfig {
  const monorepoRoot = join(process.cwd(), "../..");
  const isMonorepo = existsSync(join(monorepoRoot, "pnpm-workspace.yaml"));

  // Read agent bundle and config paths from clawrun.json (written by CLI at deploy time).
  // Also derive implementation-specific external packages from config.
  const externalPackages = [...coreExternalPackages];
  let agentBundlePaths: string[] = [];
  let agentConfigPaths: string[] = [];
  const configPath = join(process.cwd(), "clawrun.json");
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    agentBundlePaths = raw.agent?.bundlePaths ?? [];
    agentConfigPaths = raw.agent?.configPaths ?? [];

    const agentName: string | undefined = raw.agent?.name;
    const providerName: string | undefined = raw.instance?.provider;
    if (agentName) externalPackages.push(`@clawrun/agent-${agentName}`);
    if (providerName) externalPackages.push(`@clawrun/provider-${providerName}`);

    // Provider SDK packages declared in config (e.g. @vercel/sandbox)
    const extraExternals: string[] = raw.serverExternalPackages ?? [];
    externalPackages.push(...extraExternals);
  }

  const resolvedAgentPaths = agentBundlePaths.map((p) => `./${p}`);

  // Config files that must be bundled with every function.
  const configPaths = ["./clawrun.json", ...agentConfigPaths.map((p) => `./agent/${p}`)];

  // Sidecar scripts injected into sandbox (daemon supervisor + heartbeat + health).
  const sidecarPaths = ["./node_modules/@clawrun/runtime/dist/scripts/sidecar/*"];

  const allPaths = [...resolvedAgentPaths, ...configPaths, ...sidecarPaths];

  return {
    ...(isMonorepo ? { outputFileTracingRoot: monorepoRoot } : {}),
    transpilePackages: ["@clawrun/ui"],
    serverExternalPackages: externalPackages,
    outputFileTracingIncludes: {
      "/": allPaths,
    },
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Frame-Options", value: "DENY" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            {
              key: "Strict-Transport-Security",
              value: "max-age=31536000; includeSubDomains",
            },
            {
              key: "Referrer-Policy",
              value: "strict-origin-when-cross-origin",
            },
          ],
        },
      ];
    },
    ...overrides,
  };
}
