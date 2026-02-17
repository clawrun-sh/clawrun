import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { execa } from "execa";

const ZEROCLAW_REPO = "https://github.com/zeroclaw-labs/zeroclaw.git";
const DOCKER_IMAGE = "cloudclaw-zeroclaw-builder";
const DOCKER_CONTAINER = "cloudclaw-zeroclaw-extract";

// Custom Dockerfile that produces a statically-linked musl binary
// so it works regardless of the host glibc version.
const STATIC_DOCKERFILE = `
FROM rust:1.92-alpine AS builder
RUN apk add --no-cache musl-dev git pkgconfig
WORKDIR /app
RUN git clone ${ZEROCLAW_REPO} .
RUN cargo build --release
RUN strip target/release/zeroclaw
`;

export async function buildAgentBinary(targetDir: string): Promise<void> {
  const binDir = join(targetDir, "public", "bin");
  const binPath = join(binDir, "zeroclaw-linux-amd64");

  // Skip if already built
  if (existsSync(binPath)) {
    console.log(chalk.green("  ZeroClaw binary already exists, skipping build."));
    return;
  }

  console.log(chalk.cyan("\nBuilding ZeroClaw agent binary...\n"));
  console.log(chalk.dim("  Compiling statically-linked binary via Docker (this may take a few minutes).\n"));

  mkdirSync(binDir, { recursive: true });

  // Build static musl binary using a custom Dockerfile piped via stdin
  try {
    await execa(
      "docker",
      ["build", "--platform", "linux/amd64", "-t", DOCKER_IMAGE, "-f", "-", "."],
      { stdio: ["pipe", "inherit", "inherit"], input: STATIC_DOCKERFILE },
    );
  } catch (error) {
    console.error(chalk.red("\n  Docker build failed."));
    if (error instanceof Error) {
      console.error(chalk.dim(`  ${error.message}`));
    }
    console.error(chalk.yellow("  Make sure Docker is running and try again."));
    process.exit(1);
  }

  // Extract binary from the builder image
  console.log(chalk.dim("\n  Extracting binary..."));

  try {
    // Clean up stale container if it exists
    try {
      await execa("docker", ["rm", "-f", DOCKER_CONTAINER]);
    } catch {
      // doesn't exist, fine
    }

    await execa("docker", ["create", "--name", DOCKER_CONTAINER, DOCKER_IMAGE]);
    await execa("docker", ["cp", `${DOCKER_CONTAINER}:/app/target/release/zeroclaw`, binPath]);
    await execa("docker", ["rm", DOCKER_CONTAINER]);

    console.log(chalk.green("  ZeroClaw binary built successfully."));
  } catch (error) {
    console.error(chalk.red("\n  Failed to extract binary from Docker image."));
    if (error instanceof Error) {
      console.error(chalk.dim(`  ${error.message}`));
    }
    process.exit(1);
  }
}
