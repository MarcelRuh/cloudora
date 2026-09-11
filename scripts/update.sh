#!/usr/bin/env bash
# Cloudora host-side updater (CLI counterpart to Administration → System)
#
# wget -qO- https://raw.githubusercontent.com/MarcelRuh/cloudora/main/scripts/update.sh | bash
set -euo pipefail

REPO="${CLOUDORA_REPO:-MarcelRuh/cloudora}"
BRANCH="${CLOUDORA_BRANCH:-main}"

SCRIPT="${BASH_SOURCE[0]:-$0}"
if [[ -f "$SCRIPT" && "$SCRIPT" != /dev/fd/* && "$SCRIPT" != "-" ]]; then
  DEFAULT_DIR="$(cd "$(dirname "$SCRIPT")/.." && pwd)"
else
  DEFAULT_DIR="/opt/cloudora"
fi
INSTALL_DIR="${CLOUDORA_DIR:-${CLOUDORA_INSTALL_DIR:-$DEFAULT_DIR}}"

export CLOUDORA_INSTALL_DIR="$INSTALL_DIR"
export CLOUDORA_REPO="$REPO"
export CLOUDORA_BRANCH="$BRANCH"

if [[ -f "${INSTALL_DIR}/scripts/self-update-apply.sh" ]]; then
  exec sh "${INSTALL_DIR}/scripts/self-update-apply.sh"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
wget -qO "$TMP" "https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/self-update-apply.sh"
chmod +x "$TMP"
exec sh "$TMP"
