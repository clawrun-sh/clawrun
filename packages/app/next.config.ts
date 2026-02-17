import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["grammy", "@vercel/sandbox"],
  outputFileTracingIncludes: {
    "/api/webhook/telegram": ["./public/bin/**/*"],
  },
};

export default nextConfig;
