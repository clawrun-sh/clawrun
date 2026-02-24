import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Platform = "linux-x64" | "darwin-arm64" | "darwin-x64";

function currentPlatform(): Platform {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const os = process.platform === "darwin" ? "darwin" : "linux";
  return `${os}-${arch}` as Platform;
}

function binaryFilename(platform: Platform): string {
  const archMap: Record<Platform, string> = {
    "linux-x64": "zeroclaw-linux-amd64",
    "darwin-arm64": "zeroclaw-darwin-arm64",
    "darwin-x64": "zeroclaw-darwin-amd64",
  };
  return archMap[platform];
}

/**
 * Resolves the path to the ZeroClaw binary for a given platform.
 * Tries __dirname first, then process.cwd() (for Vercel serverless where
 * __dirname points to the build-time path, not the runtime path).
 */
export function getBinaryPath(platform?: Platform): string {
  const p = platform ?? currentPlatform();
  const filename = binaryFilename(p);

  // Try relative to compiled output (works locally and in dev)
  const standardPath = join(__dirname, "bin", filename);
  if (existsSync(standardPath)) return standardPath;

  // On Vercel, __dirname is the build-time path (/vercel/path0/...) but the
  // function runs from /var/task/. Resolve via cwd + node_modules.
  const cwdPath = join(process.cwd(), "node_modules", "zeroclaw", "dist", "bin", filename);
  if (existsSync(cwdPath)) return cwdPath;

  throw new Error(
    `ZeroClaw binary not found at ${standardPath}. ` +
      `Run "pnpm build" in the zeroclaw package to prepare the binary.`,
  );
}
