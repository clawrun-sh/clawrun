#!/bin/bash
set -e

# Build context needs both zeroclaw-patch and the napi crate.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTEXT_DIR=$(mktemp -d)

trap "rm -rf $CONTEXT_DIR" EXIT

# Copy zeroclaw source into context
cp -r /tmp/zeroclaw-patch "$CONTEXT_DIR/zeroclaw-patch"

# Copy napi crate into context
mkdir -p "$CONTEXT_DIR/packages"
cp -r "$SCRIPT_DIR" "$CONTEXT_DIR/packages/zeroclaw-napi"

# Copy Dockerfile to context root
cp "$SCRIPT_DIR/Dockerfile" "$CONTEXT_DIR/Dockerfile"

echo "=== Building Docker image ==="
docker build -t zeroclaw-napi-poc "$CONTEXT_DIR"

# Stop any existing container
docker rm -f zeroclaw-napi-test 2>/dev/null || true

echo ""
echo "=== Starting container ==="
docker run -d --name zeroclaw-napi-test zeroclaw-napi-poc

echo ""
echo "=== Running test.mjs ==="
docker exec zeroclaw-napi-test node test.mjs

echo ""
echo "=== Container is running. You can now: ==="
echo "  docker exec -it zeroclaw-napi-test node     # interactive Node.js REPL"
echo "  docker exec -it zeroclaw-napi-test bash      # shell into container"
echo "  docker exec zeroclaw-napi-test node test.mjs  # re-run tests"
echo "  docker exec -it zeroclaw-napi-test node demo.mjs  # interactive wizard demo"
echo "  docker rm -f zeroclaw-napi-test               # stop & remove"
