# Build image for the Next.js application (server routes stay enabled: no static export).
# Debian slim is used instead of Alpine so that the Prisma engine and the
# PostgreSQL driver behave consistently with local development.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Prisma client is generated code, not committed: it must exist before building.
# NEXT_OUTPUT selects the standalone server output used by this image.
RUN npx prisma generate && NEXT_OUTPUT=standalone npm run build

# One-shot database tooling image, used by the `migrate` and `seed` services in
# compose.yaml. It is based on `builder` on purpose: prisma/seed.ts imports
# application modules (@/lib/db, @/modules/identity) and the generated Prisma
# client, so it needs the source tree, `tsx` and the Prisma CLI. Those layers are
# already built for the application, so this stage costs no extra build time, and
# the runner image stays free of the Prisma CLI (a dev dependency of about 210 MB
# that the standalone output does not trace).
# Migrations and the seed are applied from this image, never from a workstation.
FROM builder AS db-tools
WORKDIR /app
# The Debian slim image ships no OpenSSL, which the Prisma migration engine looks
# for: without it Prisma warns and falls back to an openssl-1.1.x build.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# Default task; the seed service overrides it. The Prisma config imports
# "dotenv/config" and reads DATABASE_URL from the environment passed by compose:
# no secret lives in the image, and .env is excluded by .dockerignore.
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 1001 --create-home nextjs
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
