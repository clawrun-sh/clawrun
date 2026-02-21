FROM node:22-slim

# Install build tools and Rust deps
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    libsqlite3-dev \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy zeroclaw source
COPY zeroclaw-patch /zeroclaw-patch

# Copy napi crate
WORKDIR /app
COPY packages/zeroclaw-napi/Cargo.toml packages/zeroclaw-napi/build.rs packages/zeroclaw-napi/package.json /app/
COPY packages/zeroclaw-napi/src /app/src

# Install node deps
RUN pnpm install

# Build the napi crate (debug for speed)
RUN pnpm build:debug

# Copy test files last (doesn't bust cache)
COPY packages/zeroclaw-napi/test.mjs /app/test.mjs
COPY packages/zeroclaw-napi/demo.mjs /app/demo.mjs

# Keep container running for interactive testing
CMD ["sleep", "infinity"]
