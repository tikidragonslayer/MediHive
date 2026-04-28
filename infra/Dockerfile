# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-server/package.json packages/api-server/

RUN npm ci --workspace=packages/shared --workspace=packages/api-server

COPY packages/shared/ packages/shared/
COPY packages/api-server/ packages/api-server/

RUN npm run build --workspace=packages/shared --workspace=packages/api-server

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-server/package.json packages/api-server/

RUN npm ci --workspace=packages/shared --workspace=packages/api-server --omit=dev

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api-server/dist packages/api-server/dist

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "packages/api-server/dist/index.js"]
