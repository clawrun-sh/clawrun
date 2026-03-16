#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ============================================================
# Upstream source preparation
# ============================================================

UPSTREAM_DIR="$SCRIPT_DIR/upstream"
ZEROCLAW_VERSION=$(cat "$UPSTREAM_DIR/VERSION" | tr -d '[:space:]')
ZEROCLAW_SRC="/tmp/zeroclaw-bin-src"

apply_patches() {
  # Apply .patch files in order
  for patch in "$UPSTREAM_DIR"/patches/*.patch; do
    [ -f "$patch" ] || continue
    echo "  Applying $(basename "$patch")..."
    git -C "$ZEROCLAW_SRC" apply "$patch"
  done

  # Copy overlay files (new files that aren't patches)
  if [ -d "$UPSTREAM_DIR/overlay" ] && ls "$UPSTREAM_DIR/overlay/"* &>/dev/null; then
    echo "  Copying overlay files..."
    cp -r "$UPSTREAM_DIR/overlay/"* "$ZEROCLAW_SRC/"
  fi
}

prepare_source() {
  # Reuse existing checkout if it's at the right version
  if [ -d "$ZEROCLAW_SRC/.git" ]; then
    CURRENT_TAG=$(git -C "$ZEROCLAW_SRC" describe --tags --exact-match HEAD 2>/dev/null || echo "")
    if [ "$CURRENT_TAG" = "$ZEROCLAW_VERSION" ]; then
      echo "  Reusing cached zeroclaw source at $ZEROCLAW_VERSION"
      git -C "$ZEROCLAW_SRC" checkout -- .
      # Remove overlay files that aren't tracked (from previous apply)
      git -C "$ZEROCLAW_SRC" clean -fd 2>/dev/null || true
      apply_patches
      return
    fi
    rm -rf "$ZEROCLAW_SRC"
  fi

  echo "  Cloning zeroclaw at $ZEROCLAW_VERSION..."
  git clone --filter=blob:none https://github.com/zeroclaw-labs/zeroclaw.git "$ZEROCLAW_SRC"
  git -C "$ZEROCLAW_SRC" checkout "$ZEROCLAW_VERSION"
  apply_patches
}

# ============================================================
# Build linux-amd64 binary via Docker
# ============================================================

DIST_DIR="$SCRIPT_DIR/dist/bin"
DEST_BIN="$DIST_DIR/zeroclaw-linux-amd64"

echo "=========================================="
echo "  Building ZeroClaw binary (linux-amd64)"
echo "  Version: $ZEROCLAW_VERSION"
echo "=========================================="

prepare_source

# Prepare build context
CONTEXT_DIR=$(mktemp -d)
trap "rm -rf $CONTEXT_DIR" EXIT

cp -r "$ZEROCLAW_SRC" "$CONTEXT_DIR/zeroclaw-src"
cp "$SCRIPT_DIR/Dockerfile" "$CONTEXT_DIR/Dockerfile"

IMAGE_TAG="zeroclaw-builder"
CONTAINER_NAME="zeroclaw-build-extract"

echo ""
echo "--- Building x86_64-unknown-linux-musl ---"

BUILD_LOG=$(mktemp)
if ! docker build \
  --platform linux/amd64 \
  -t "$IMAGE_TAG" \
  "$CONTEXT_DIR" > "$BUILD_LOG" 2>&1; then
  echo "Docker build FAILED. Last 40 lines:"
  echo "---"
  tail -40 "$BUILD_LOG"
  echo "---"
  echo "Full log: $BUILD_LOG"
  exit 1
fi

# Show only warnings from build output
if grep -iE '(warning|warn\b)' "$BUILD_LOG" | grep -v '^#[0-9]' | head -20 > /dev/null 2>&1; then
  WARNINGS=$(grep -iE '(warning|warn\b)' "$BUILD_LOG" | grep -v '^#[0-9]' | head -20)
  if [ -n "$WARNINGS" ]; then
    echo "  Warnings:"
    echo "$WARNINGS" | sed 's/^/    /'
  fi
fi
rm -f "$BUILD_LOG"

# Extract binary
docker rm -f "$CONTAINER_NAME" &>/dev/null || true
docker create --name "$CONTAINER_NAME" "$IMAGE_TAG" /bin/true &>/dev/null

mkdir -p "$DIST_DIR"

docker cp "$CONTAINER_NAME:/app/target/x86_64-unknown-linux-musl/release-fast/zeroclaw" "$DEST_BIN"
docker cp "$CONTAINER_NAME:/zeroclaw-config.schema.json" "$SCRIPT_DIR/src/zeroclaw-config.schema.json"
docker rm -f "$CONTAINER_NAME" &>/dev/null || true

chmod +x "$DEST_BIN"

# Summary
SIZE=$(ls -lh "$DEST_BIN" | awk '{print $5}')
SCHEMA_SIZE=$(ls -lh "$SCRIPT_DIR/src/zeroclaw-config.schema.json" | awk '{print $5}')
echo ""
echo "=== Build Summary ==="
echo "  Version: $ZEROCLAW_VERSION"
echo "  zeroclaw-linux-amd64: $SIZE"
echo "  zeroclaw-config.schema.json: $SCHEMA_SIZE"
echo ""
echo "Done!"
