FROM node:22-slim

ARG TARGET=aarch64-unknown-linux-gnu

# Install base build tools
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Install cross-compilation toolchain if needed
RUN if [ "$TARGET" = "x86_64-unknown-linux-gnu" ] && [ "$(uname -m)" = "aarch64" ]; then \
      apt-get update && apt-get install -y gcc-x86-64-linux-gnu g++-x86-64-linux-gnu && rm -rf /var/lib/apt/lists/*; \
    elif [ "$TARGET" = "aarch64-unknown-linux-gnu" ] && [ "$(uname -m)" = "x86_64" ]; then \
      apt-get update && apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu && rm -rf /var/lib/apt/lists/*; \
    fi

# Install Rust + target
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add $TARGET

# Set up cross-compilation linker if needed
RUN mkdir -p /root/.cargo && \
    if [ "$TARGET" = "x86_64-unknown-linux-gnu" ] && [ "$(uname -m)" = "aarch64" ]; then \
      printf '[target.x86_64-unknown-linux-gnu]\nlinker = "x86_64-linux-gnu-gcc"\n' >> /root/.cargo/config.toml; \
    elif [ "$TARGET" = "aarch64-unknown-linux-gnu" ] && [ "$(uname -m)" = "x86_64" ]; then \
      printf '[target.aarch64-unknown-linux-gnu]\nlinker = "aarch64-linux-gnu-gcc"\n' >> /root/.cargo/config.toml; \
    fi

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

# Build the napi crate for the specified target
RUN npx napi build --release --platform --target $TARGET

# Copy test file for verification
COPY packages/zeroclaw-napi/test.mjs /app/test.mjs

# Keep container running for inspection
CMD ["sleep", "infinity"]
