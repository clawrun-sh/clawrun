#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ============================================================
# Upstream source preparation
# ============================================================

UPSTREAM_DIR="$SCRIPT_DIR/upstream"
ZEROCLAW_SHA=$(cat "$UPSTREAM_DIR/COMMIT" | tr -d '[:space:]')
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
  # Reuse existing checkout if it's at the right commit
  if [ -d "$ZEROCLAW_SRC/.git" ]; then
    CURRENT_SHA=$(git -C "$ZEROCLAW_SRC" rev-parse HEAD 2>/dev/null || echo "")
    if [ "$CURRENT_SHA" = "$ZEROCLAW_SHA" ]; then
      echo "  Reusing cached zeroclaw source at $ZEROCLAW_SHA"
      git -C "$ZEROCLAW_SRC" checkout -- .
      apply_patches
      return
    fi
    rm -rf "$ZEROCLAW_SRC"
  fi

  echo "  Cloning zeroclaw at $ZEROCLAW_SHA..."
  git clone --filter=blob:none https://github.com/zeroclaw-labs/zeroclaw.git "$ZEROCLAW_SRC"
  git -C "$ZEROCLAW_SRC" checkout "$ZEROCLAW_SHA"
  apply_patches
}

# ============================================================
# Build linux-amd64 binary via Docker
# ============================================================

DIST_DIR="$SCRIPT_DIR/dist/bin"
DEST_BIN="$DIST_DIR/zeroclaw-linux-amd64"

echo "=========================================="
echo "  Building ZeroClaw binary (linux-amd64)"
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

docker build \
  --platform linux/amd64 \
  -t "$IMAGE_TAG" \
  "$CONTEXT_DIR"

# Extract binary
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
docker create --name "$CONTAINER_NAME" "$IMAGE_TAG" /bin/true

mkdir -p "$DIST_DIR"

docker cp "$CONTAINER_NAME:/app/target/release/zeroclaw" "$DEST_BIN"
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

chmod +x "$DEST_BIN"

# Summary
SIZE=$(ls -lh "$DEST_BIN" | awk '{print $5}')
echo ""
echo "=== Build Summary ==="
echo "  zeroclaw-linux-amd64: $SIZE"
echo ""
echo "Done!"
