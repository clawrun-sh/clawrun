#!/usr/bin/env node

/**
 * Build-time script: builds the ZeroClaw linux-amd64 binary via Docker
 * and places it in dist/bin/.
 *
 * The binary is built from upstream ZeroClaw with CloudClaw patches applied
 * (Postgres memory backend). Requires Docker to be running.
 *
 * The binary ships to Vercel via `pnpm pack` (included in the tarball
 * because "files": ["dist"] in package.json). It does NOT need to be
 * committed to git.
 *
 * Runs as the `build:bin` turbo task.
 */

import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const DIST_BIN_DIR = join(PKG_ROOT, "dist", "bin");
const DEST_BIN = join(DIST_BIN_DIR, "zeroclaw-linux-amd64");

const DOCKER_IMAGE = "zeroclaw-builder";
const DOCKER_CONTAINER = "zeroclaw-extract";
const DOCKERFILE_PATH = join(PKG_ROOT, "docker", "Dockerfile");

// Pin ZeroClaw to a specific commit for reproducible builds.
// Update this when upgrading ZeroClaw version (may require patch adjustments).
const ZEROCLAW_COMMIT = process.env.ZEROCLAW_COMMIT || "61eb72f";

mkdirSync(DIST_BIN_DIR, { recursive: true });

if (existsSync(DEST_BIN)) {
  console.log("prepare-binary: dist/bin/zeroclaw-linux-amd64 exists, skipping Docker build");
} else {
  console.log("prepare-binary: Building ZeroClaw via Docker...");

  execSync(
    `docker build --platform linux/amd64 ` +
    `--build-arg ZEROCLAW_COMMIT=${ZEROCLAW_COMMIT} ` +
    `-t ${DOCKER_IMAGE} -f ${DOCKERFILE_PATH} ${PKG_ROOT}`,
    { stdio: "inherit" },
  );

  try {
    execSync(`docker rm -f ${DOCKER_CONTAINER}`, { stdio: "ignore" });
  } catch {
    // container doesn't exist, fine
  }

  execSync(`docker create --name ${DOCKER_CONTAINER} ${DOCKER_IMAGE} /bin/true`, {
    stdio: "inherit",
  });
  execSync(`docker cp ${DOCKER_CONTAINER}:/app/target/release/zeroclaw ${DEST_BIN}`, {
    stdio: "inherit",
  });
  execSync(`docker rm ${DOCKER_CONTAINER}`, { stdio: "inherit" });
}

chmodSync(DEST_BIN, 0o755);
console.log("prepare-binary: Done — dist/bin/zeroclaw-linux-amd64 ready");
