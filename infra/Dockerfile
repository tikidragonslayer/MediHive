# MediHive — Copyright (C) 2024-2026 The MediHive Authors
# Licensed under the GNU Affero General Public License v3.0 or later.
#
# Two-stage Docker build for the api-server. Includes every workspace
# the api-server transitively depends on so the local-profile compose
# stack works without any external registry.

# =====================================================
# Stage 1: build all workspaces the api-server uses
# =====================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Bring in lockfile + every workspace package.json the api-server needs.
# (packages/shared is intentionally not a workspace — it has source files
#  but no package.json, and nothing currently imports it as @medi-hive/shared.)
COPY package.json package-lock.json ./
COPY packages/vault-driver/package.json packages/vault-driver/
COPY packages/local-vault/package.json packages/local-vault/
COPY packages/brain-engine/package.json packages/brain-engine/
COPY packages/api-server/package.json packages/api-server/

# Install all of them with workspace links wired up.
RUN npm ci \
  --workspace=packages/vault-driver \
  --workspace=packages/local-vault \
  --workspace=packages/brain-engine \
  --workspace=packages/api-server

# Copy source for everything we install.
COPY packages/vault-driver/ packages/vault-driver/
COPY packages/local-vault/ packages/local-vault/
COPY packages/brain-engine/ packages/brain-engine/
COPY packages/api-server/ packages/api-server/

# Build each workspace in dependency order.
RUN npm run build --workspace=packages/vault-driver && \
    npm run build --workspace=packages/local-vault && \
    npm run build --workspace=packages/brain-engine && \
    npm run build --workspace=packages/api-server

# =====================================================
# Stage 2: minimal runtime image
# =====================================================
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Re-declare package.json files for the production install.
COPY package.json package-lock.json ./
COPY packages/vault-driver/package.json packages/vault-driver/
COPY packages/local-vault/package.json packages/local-vault/
COPY packages/brain-engine/package.json packages/brain-engine/
COPY packages/api-server/package.json packages/api-server/

# Production-only install — drop devDeps to shrink image.
RUN npm ci --omit=dev \
  --workspace=packages/vault-driver \
  --workspace=packages/local-vault \
  --workspace=packages/brain-engine \
  --workspace=packages/api-server

# Pull built artifacts from the builder stage.
COPY --from=builder /app/packages/vault-driver/dist packages/vault-driver/dist
COPY --from=builder /app/packages/local-vault/dist packages/local-vault/dist
# Migration runner reads SQL files at runtime via __dirname/migrations,
# so they need to ship in the image.
COPY --from=builder /app/packages/local-vault/src/migrations packages/local-vault/dist/migrations
COPY --from=builder /app/packages/brain-engine/dist packages/brain-engine/dist
COPY --from=builder /app/packages/api-server/dist packages/api-server/dist

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "packages/api-server/dist/index.js"]
