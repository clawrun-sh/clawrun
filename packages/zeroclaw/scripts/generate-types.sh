#!/bin/bash
# Generate TypeScript types from ZeroClaw's JSON Schema.
# Run after build:bin to regenerate types when upgrading ZeroClaw.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMA="$PKG_DIR/src/zeroclaw-config.schema.json"
OUT_DIR="$PKG_DIR/src/generated"

if [ ! -f "$SCHEMA" ]; then
  echo "Error: $SCHEMA not found. Run 'pnpm build:bin' first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

npx json-schema-to-typescript \
  "$SCHEMA" \
  -o "$OUT_DIR/zeroclaw-config.d.ts" \
  --bannerComment "/* Auto-generated from zeroclaw-config.schema.json — do not edit */"

echo "Generated $OUT_DIR/zeroclaw-config.d.ts"
