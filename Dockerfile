# Semantos CellToken Poker — Hackathon Submission
#
# Standalone Docker build for the poker demo.
# No monorepo dependencies — everything is in this repo.
#
# Build: docker build -t semantos-poker .
# Run:   docker compose up -d

# ── Builder Stage ─────────────────────────────────────────────────

FROM oven/bun:1-alpine AS builder

WORKDIR /build

# Copy package manifest first for layer caching
COPY package.json bun.lock* ./
RUN bun install

# Copy source
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# ── Runtime Stage ─────────────────────────────────────────────────

FROM oven/bun:1-alpine AS runtime

RUN addgroup -g 1001 semantos && \
    adduser -u 1001 -G semantos -s /sbin/nologin -D semantos

RUN mkdir -p /var/semantos/data /audit && \
    chown -R semantos:semantos /var/semantos && \
    chown semantos:semantos /audit

WORKDIR /app

COPY --from=builder --chown=semantos:semantos /build/package.json ./
COPY --from=builder --chown=semantos:semantos /build/node_modules ./node_modules
COPY --from=builder --chown=semantos:semantos /build/src ./src
COPY --from=builder --chown=semantos:semantos /build/scripts ./scripts
COPY --from=builder --chown=semantos:semantos /build/tsconfig.json ./

ENV SEMANTOS_DATA_DIR=/var/semantos/data

EXPOSE 9000/udp

USER semantos

# Default entrypoint — overridden per service in docker-compose
ENTRYPOINT ["bun", "run", "src/entrypoint-floor.ts"]
