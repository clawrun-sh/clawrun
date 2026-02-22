FROM rust:1.92-alpine AS builder

RUN apk add --no-cache musl-dev git pkgconfig perl openssl-dev openssl-libs-static

WORKDIR /app

# Source is copied into context by build-docker.sh
COPY zeroclaw-src/ .

RUN cargo build --release

RUN strip target/release/zeroclaw
