FROM rust:1.92-alpine AS builder

RUN apk add --no-cache musl-dev git pkgconfig perl openssl-dev openssl-libs-static

WORKDIR /app

# Source is copied into context by build-docker.sh
COPY zeroclaw-src/ .

RUN cargo build --release

RUN strip target/release/zeroclaw

# Extract JSON Schema from the binary (schemars-derived, Draft 2020-12)
RUN ./target/release/zeroclaw config schema 2>/dev/null \
    | sed -n '/^{/,$ p' > /zeroclaw-config.schema.json
