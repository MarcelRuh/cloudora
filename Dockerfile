# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
ENV DATABASE_URL="postgresql://cloudora:cloudora@127.0.0.1:5432/cloudora?schema=public"
ENV ENCRYPTION_KEY="build-time-placeholder-not-a-real-secret-key"
ENV SESSION_SECRET="build-time-placeholder-not-a-real-session-secret"
ENV CLOUDORA_STORAGE_PATH="/storage"
RUN npm ci
COPY . .
RUN npx prisma generate \
  && npm run build \
  && npx --yes esbuild prisma/seed.ts --bundle --platform=node --format=cjs --external:@prisma/client --outfile=dist/seed.cjs

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates wget gnupg \
  && wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist/seed.cjs ./dist/seed.cjs
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /storage
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
