# syntax=docker/dockerfile:1
#
# Production image for the ZipShip control-plane API (Bun + Elysia).
# Two stages: build the bundle, then ship a minimal runtime image.
#
# Database migrations are applied out-of-band (run `bun run db:migrate` against
# the production DATABASE_URL before / as an init container) — the server image
# only serves.

# ── build ──────────────────────────────────────────────────────────────────
FROM oven/bun:1-debian AS build
WORKDIR /app

# Copy workspace manifests first for a cacheable install layer.
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/deploy-core/package.json ./packages/deploy-core/
COPY packages/storage/package.json ./packages/storage/
RUN bun install --frozen-lockfile

# Copy source and bundle the API (Bun resolves workspace + catalog deps).
COPY apps/api ./apps/api
COPY packages ./packages
RUN bun build apps/api/src/index.ts --target=bun --outdir=apps/api/dist

# ── runtime ─────────────────────────────────────────────────────────────────
FROM oven/bun:1-debian AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Bun reads these from the environment; the compose file / orchestrator sets them.
ENV ZIPSHIP_API_PORT=3001

COPY --from=build /app/apps/api/dist/index.js ./index.js

EXPOSE 3001
# The bundled entry is self-contained; no node_modules needed at runtime.
CMD ["bun", "run", "index.js"]
