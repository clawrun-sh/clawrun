import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
// Packages that must be loaded from node_modules at runtime (not bundled by
// webpack). This ensures a single module instance is shared between the
// instrumentation hook and every route handler — critical for module-level
// singletons like the agent registry and config cache.
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

  // Build full path list: ./node_modules/<path> + monorepo variants.
  // All paths MUST be relative — absolute paths cause doubled-path errors.
  const resolvedAgentPaths: string[] = [];
  for (const p of agentBundlePaths) {
    resolvedAgentPaths.push(`./${p}`);
    if (isMonorepo && p.startsWith("node_modules/")) {
      const withoutNM = p.slice("node_modules/".length);
      const slashIdx = withoutNM.indexOf("/");
      if (slashIdx !== -1) {
        const pkg = withoutNM.slice(0, slashIdx);
        const sub = withoutNM.slice(slashIdx + 1);
        resolvedAgentPaths.push(`../${pkg}/${sub}`);
        resolvedAgentPaths.push(`../../node_modules/${pkg}/${sub}`);
      }
    }
  }

  // Config files that must be bundled with every function.
  const configPaths = ["./cloudclaw.json", "./agent/config.toml", "./agent/.secret_key"];

  // Extend-loop script injected into sandbox for keep-alive reporting.
  const extendLoopPaths = ["./node_modules/@cloudclaw/runtime/dist/scripts/extend-loop.js"];
  if (isMonorepo) {
    extendLoopPaths.push("../runtime/dist/scripts/extend-loop.js");
  }

  const allPaths = [...resolvedAgentPaths, ...configPaths, ...extendLoopPaths];

  return {
    ...(isMonorepo ? { outputFileTracingRoot: monorepoRoot } : {}),
    transpilePackages: ["@cloudclaw/server"],
    serverExternalPackages: externalPackages,
    webpack(config, { isServer }) {
      // transpilePackages causes webpack to bundle @cloudclaw/server's
      // dependencies even when they're in serverExternalPackages. Force them
      // external with an explicit externals function.
      if (isServer) {
        const prev = config.externals as unknown[];
        config.externals = [
          ...(Array.isArray(prev) ? prev : []),
          (
            { request }: { request?: string },
            callback: (err?: null | Error, result?: string) => void,
          ) => {
            if (request && externalPackages.some((p) => request === p || request.startsWith(p + "/"))) {
              return callback(null, `module ${request}`);
            }
            callback();
          },
        ];
      }
      return config;
    },
    outputFileTracingIncludes: {
      "/": allPaths,
      "/api/v1/health": allPaths,
      "/api/v1/webhook/[channel]": allPaths,
      "/api/v1/heartbeat": allPaths,
      "/api/v1/sandbox/restart": allPaths,
      "/api/v1/sandbox/start": allPaths,
      "/api/v1/sandbox/stop": allPaths,
      "/api/v1/sandbox/heartbeat": allPaths,
    },
    ...overrides,
  };
}
