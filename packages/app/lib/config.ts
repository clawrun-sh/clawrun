import type { NextConfig } from "next";

export function createNextConfig(overrides?: Partial<NextConfig>): NextConfig {
  return {
    transpilePackages: ["@cloudclaw/app"],
    serverExternalPackages: ["grammy", "@vercel/sandbox"],
    outputFileTracingIncludes: {
      "/api/webhook/telegram": [
        "./node_modules/zeroclaw/bin/**/*",
        "./public/bin/**/*",
      ],
    },
    ...overrides,
  };
}
