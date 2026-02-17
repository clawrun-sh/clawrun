import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ZEROCLAW_REPO = "https://github.com/zeroclaw-labs/zeroclaw.git";
const DOCKER_IMAGE = "zeroclaw-builder";
const DOCKER_CONTAINER = "zeroclaw-extract";

const STATIC_DOCKERFILE = `
FROM rust:1.92-alpine AS builder
RUN apk add --no-cache musl-dev git pkgconfig
WORKDIR /app
RUN git clone ${ZEROCLAW_REPO} .
RUN cargo build --release
RUN strip target/release/zeroclaw
`;

type Platform = "linux-x64" | "darwin-arm64" | "darwin-x64";

function currentPlatform(): Platform {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const os = process.platform === "darwin" ? "darwin" : "linux";
  return `${os}-${arch}` as Platform;
}

function binaryDir(): string {
  return join(__dirname, "..", "bin");
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
 * Returns the path if the binary exists, null otherwise.
 */
export function getBinaryPath(platform?: Platform): string | null {
  const p = platform ?? currentPlatform();
  const path = join(binaryDir(), binaryFilename(p));
  return existsSync(path) ? path : null;
}

/**
 * Ensures the ZeroClaw binary exists for the given platform.
 * Builds via Docker if not present. Only linux-x64 is supported for Docker builds.
 */
export async function ensureBinary(platform?: Platform): Promise<string> {
  const p = platform ?? "linux-x64";
  const dir = binaryDir();
  const filename = binaryFilename(p);
  const binPath = join(dir, filename);

  if (existsSync(binPath)) {
    return binPath;
  }

  if (p !== "linux-x64") {
    throw new Error(
      `Cannot auto-build binary for platform "${p}". ` +
      `Only linux-x64 is supported for Docker builds. ` +
      `Place the binary manually at: ${binPath}`
    );
  }

  mkdirSync(dir, { recursive: true });

  // Build via Docker
  await execa(
    "docker",
    ["build", "--platform", "linux/amd64", "-t", DOCKER_IMAGE, "-f", "-", "."],
    { stdio: ["pipe", "inherit", "inherit"], input: STATIC_DOCKERFILE },
  );

  // Extract binary
  try {
    await execa("docker", ["rm", "-f", DOCKER_CONTAINER]);
  } catch {
    // doesn't exist, fine
  }

  await execa("docker", ["create", "--name", DOCKER_CONTAINER, DOCKER_IMAGE]);
  await execa("docker", ["cp", `${DOCKER_CONTAINER}:/app/target/release/zeroclaw`, binPath]);
  await execa("docker", ["rm", DOCKER_CONTAINER]);

  return binPath;
}
