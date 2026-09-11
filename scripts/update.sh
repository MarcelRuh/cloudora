#!/usr/bin/env bash
# Cloudora host-side updater
#
# wget -qO- https://raw.githubusercontent.com/MarcelRuh/cloudora/main/scripts/update.sh | bash
set -euo pipefail

echo "Cloudora update"
echo "Preserves .env, Docker volumes and ./storage"

SCRIPT="${BASH_SOURCE[0]:-$0}"
if [[ -f "$SCRIPT" && "$SCRIPT" != /dev/fd/* && "$SCRIPT" != "-" ]]; then
  ROOT="$(cd "$(dirname "$SCRIPT")/.." && pwd)"
else
  ROOT="${CLOUDORA_DIR:-/opt/cloudora}"
fi
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env – aborting." >&2
  exit 1
fi

BRANCH="${CLOUDORA_BRANCH:-main}"
REPO="${CLOUDORA_REPO:-MarcelRuh/cloudora}"

if [[ -d .git ]]; then
  git fetch origin "$BRANCH"
  git merge --ff-only "origin/$BRANCH" || git pull --ff-only origin "$BRANCH"
else
  echo "No git checkout; skip source sync. Clone from https://github.com/${REPO}.git"
fi

docker compose -f docker-compose.prod.yml up -d --build

echo "Cloudora update finished."
