FROM rust:1.92-alpine AS builder

RUN apk add --no-cache musl-dev git

WORKDIR /app

# Source is copied into context by build-docker.sh
COPY zeroclaw-src/ .

RUN cargo build --profile release-fast --locked --target x86_64-unknown-linux-musl

# Extract JSON Schema from the binary (schemars-derived, Draft 2020-12)
RUN ./target/x86_64-unknown-linux-musl/release-fast/zeroclaw config schema 2>/dev/null \
    | sed -n '/^{/,$ p' > /zeroclaw-config.schema.json
