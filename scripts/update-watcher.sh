#!/bin/sh
# Sidecar: docker.sock on this helper only (not the app).
# The Cloudora app only writes a request file.
set -eu

INSTALL_DIR="${CLOUDORA_INSTALL_DIR:-/opt/cloudora}"
SIGNAL_DIR="${CLOUDORA_UPDATE_SIGNAL_DIR:-/update-signal}"
REPO="${CLOUDORA_REPO:-MarcelRuh/cloudora}"
BRANCH="${CLOUDORA_BRANCH:-main}"
UPDATER_NAME="cloudora-self-updater"
UPDATER_IMAGE="${CLOUDORA_UPDATER_IMAGE:-docker:27.5.1-cli}"
SIGNAL_VOLUME="${CLOUDORA_SIGNAL_VOLUME:-cloudora_update_signal}"
APPLY="${INSTALL_DIR}/scripts/self-update-apply.sh"
REQUEST="${SIGNAL_DIR}/request"
COMPOSE_UP="${SIGNAL_DIR}/compose-up"
VOLUMES_SPEC="${SIGNAL_DIR}/extra-volumes.yml"
LOCK="${SIGNAL_DIR}/.cloudora-update.lock"

if ! echo "$REPO" | grep -Eq '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; then
  echo "ERROR: invalid CLOUDORA_REPO" >&2
  exit 1
fi
if ! echo "$BRANCH" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
  echo "ERROR: invalid CLOUDORA_BRANCH" >&2
  exit 1
fi

mkdir -p "$SIGNAL_DIR"
echo "==> Cloudora update watcher"
echo " dir=${INSTALL_DIR} signal=${SIGNAL_DIR} repo=${REPO} branch=${BRANCH}"

updater_running() {
  docker ps --filter "name=^${UPDATER_NAME}$" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -qx "$UPDATER_NAME"
}

sync_lock() {
  if updater_running; then
    touch "$LOCK"
  else
    rm -f "$LOCK"
  fi
}

start_updater() {
  if [ ! -f "$APPLY" ]; then
    echo "ERROR: missing $APPLY" >&2
    return 1
  fi
  TAG=""
  if [ -f "${SIGNAL_DIR}/target" ]; then
    TAG="$(tr -d '[:space:]' < "${SIGNAL_DIR}/target")"
  fi
  docker rm -f "$UPDATER_NAME" >/dev/null 2>&1 || true
  docker run -d --init --name "$UPDATER_NAME" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${INSTALL_DIR}:${INSTALL_DIR}" \
    -v "${SIGNAL_VOLUME}:/update-signal" \
    -e "COMPOSE_BAKE=false" \
    -e "CLOUDORA_INSTALL_DIR=${INSTALL_DIR}" \
    -e "CLOUDORA_REPO=${REPO}" \
    -e "CLOUDORA_BRANCH=${BRANCH}" \
    -e "CLOUDORA_RELEASE_TAG=${TAG}" \
    -e "CLOUDORA_SKIP_COMPOSE=0" \
    -e "CLOUDORA_UPDATE_SIGNAL_DIR=/update-signal" \
    -e "GITHUB_TOKEN=${GITHUB_TOKEN:-}" \
    -e "GH_TOKEN=${GH_TOKEN:-}" \
    -w "$INSTALL_DIR" \
    --label cloudora.update=self \
    "$UPDATER_IMAGE" sh "$APPLY"
}

compose_files() {
  if [ -f "${INSTALL_DIR}/docker-compose.prod.yml" ]; then
    printf '%s' "-f docker-compose.prod.yml"
  else
    printf '%s' "-f docker-compose.yml"
  fi
  if [ -f "${INSTALL_DIR}/docker-compose.override.yml" ]; then
    printf ' %s' "-f docker-compose.override.yml"
  fi
  if [ -f "${INSTALL_DIR}/docker-compose.cloudora-volumes.yml" ]; then
    printf ' %s' "-f docker-compose.cloudora-volumes.yml"
  fi
}

apply_extra_volumes() {
  if [ -f "$VOLUMES_SPEC" ]; then
    cp "$VOLUMES_SPEC" "${INSTALL_DIR}/docker-compose.cloudora-volumes.yml"
  fi
  echo "==> Applying extra storage volumes"
  cd "$INSTALL_DIR"
  if [ -S /var/run/docker.sock ]; then
    unset DOCKER_HOST
  fi
  # shellcheck disable=SC2046
  docker compose $(compose_files) up -d --no-build --remove-orphans
}

sync_lock

while true; do
  if [ -f "$COMPOSE_UP" ]; then
    rm -f "$COMPOSE_UP"
    if updater_running; then
      echo "==> Skip compose-up, updater running"
    else
      apply_extra_volumes || echo "==> compose-up failed" >&2
    fi
  fi
  if [ -f "$REQUEST" ]; then
    rm -f "$REQUEST"
    if updater_running; then
      echo "==> Update already running"
    else
      echo "==> Update requested"
      touch "$LOCK"
      if ! start_updater; then
        echo "==> Failed to start updater" >&2
        rm -f "$LOCK"
      fi
    fi
  fi
  sync_lock
  sleep 2
done
