#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi
export NODE_ENV=production
export CLOUDORA_RUNTIME=native
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
if [ -f "$ROOT/.next/standalone/server.js" ]; then
  # Standalone serves assets from its own tree; next build does not copy them there.
  mkdir -p "$ROOT/.next/standalone/.next"
  if [ -d "$ROOT/.next/static" ]; then
    rm -rf "$ROOT/.next/standalone/.next/static"
    cp -a "$ROOT/.next/static" "$ROOT/.next/standalone/.next/static"
  fi
  if [ -d "$ROOT/public" ]; then
    mkdir -p "$ROOT/.next/standalone/public"
    cp -a "$ROOT/public/." "$ROOT/.next/standalone/public/"
  fi
  exec node -r "$ROOT/scripts/http-timeouts.cjs" "$ROOT/.next/standalone/server.js"
fi
exec node "$ROOT/node_modules/next/dist/bin/next" start -H 0.0.0.0 -p "${PORT:-3000}"
