#!/bin/sh
set -eu

mkdir -p \
  "${CLOUDORA_STORAGE_PATH:-/storage}/${CLOUDORA_USERS_DIR:-users}" \
  "${CLOUDORA_STORAGE_PATH:-/storage}/${CLOUDORA_SHARED_DIR:-shared}" \
  "${CLOUDORA_STORAGE_PATH:-/storage}/.trash"

dburl="${DATABASE_URL%%\?*}"

echo "Cloudora: applying database migrations…"
psql "$dburl" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
SQL

for dir in /app/prisma/migrations/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  sql="${dir}migration.sql"
  [ -f "$sql" ] || continue
  applied="$(psql "$dburl" -tAc "SELECT 1 FROM \"_prisma_migrations\" WHERE migration_name='${name}' AND finished_at IS NOT NULL" | tr -d '[:space:]')"
  if [ "$applied" = "1" ]; then
    continue
  fi
  echo "Cloudora: migration ${name}"
  psql "$dburl" -v ON_ERROR_STOP=1 -f "$sql" >/dev/null
  id="$(openssl rand -hex 16)"
  checksum="$(sha256sum "$sql" | awk '{print $1}')"
  psql "$dburl" -v ON_ERROR_STOP=1 -c "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('${id}', '${checksum}', now(), '${name}', 1);" >/dev/null
done

echo "Cloudora: ensuring bootstrap admin…"
node dist/seed.cjs

echo "Cloudora: starting…"
exec node server.js
