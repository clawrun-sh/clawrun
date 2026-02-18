# Dockerfile — Build ZeroClaw with CloudClaw's Postgres memory backend
#
# Build context: packages/zeroclaw/ (so COPY src-rust/ and COPY patches/ work)
#
# Usage:
#   docker build --platform linux/amd64 \
#     --build-arg ZEROCLAW_COMMIT=<hash> \
#     -t zeroclaw-builder \
#     -f docker/Dockerfile .

FROM rust:1.92-alpine AS builder

RUN apk add --no-cache musl-dev git pkgconfig perl openssl-dev openssl-libs-static

WORKDIR /app

ARG ZEROCLAW_COMMIT=61eb72f
RUN git clone https://github.com/zeroclaw-labs/zeroclaw.git . \
    && git checkout ${ZEROCLAW_COMMIT}

# Copy CloudClaw's Postgres backend source
COPY src-rust/postgres.rs src/memory/postgres.rs

# Apply CloudClaw patches to existing ZeroClaw files
COPY patches/add-postgres-backend.patch /tmp/
RUN git apply /tmp/add-postgres-backend.patch

# Build with postgres feature enabled
RUN cargo build --release --features postgres

# Strip the binary for smaller size
RUN strip target/release/zeroclaw
