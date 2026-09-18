#!/bin/sh
# Shared apply script (host CLI + in-app updater container).
# Env: CLOUDORA_INSTALL_DIR, CLOUDORA_REPO, CLOUDORA_BRANCH, CLOUDORA_RELEASE_TAG
# CLOUDORA_SKIP_COMPOSE=1 → sync files only
set -eu

INSTALL_DIR="${CLOUDORA_INSTALL_DIR:-/opt/cloudora}"
REPO="${CLOUDORA_REPO:-MarcelRuh/cloudora}"
BRANCH="${CLOUDORA_BRANCH:-main}"
RELEASE_TAG="${CLOUDORA_RELEASE_TAG:-}"
SKIP_COMPOSE="${CLOUDORA_SKIP_COMPOSE:-0}"
CLONE_URL="https://github.com/${REPO}.git"
PROGRESS_FILE="${INSTALL_DIR}/.cloudora-update-progress"
LOCK_DIR="${INSTALL_DIR}/.cloudora-update.lock"
COMPOSE_LOG_FILE="${INSTALL_DIR}/.cloudora-update-compose.log"
SIGNAL_DIR="${CLOUDORA_UPDATE_SIGNAL_DIR:-}"
rm -f "$PROGRESS_FILE"

mirror_progress() {
  if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ] && [ -f "$PROGRESS_FILE" ]; then
    cp "$PROGRESS_FILE" "${SIGNAL_DIR}/.cloudora-update-progress" 2>/dev/null || true
  fi
}

if [ -d "$LOCK_DIR" ]; then
  echo "==> Clearing leftover update lock"
  rm -rf "$LOCK_DIR"
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "ERROR: another Cloudora update is already running" >&2
  printf 'percent=%s\nstep=%s\ndetail=%s\n' 0 error "Update already running" > "$PROGRESS_FILE"
  mirror_progress
  exit 1
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

write_progress() {
  percent="$1"
  step="$2"
  detail="${3:-}"
  last=0
  if [ -f "$PROGRESS_FILE" ]; then
    parsed="$(sed -n 's/^percent=\([0-9][0-9]*\).*/\1/p' "$PROGRESS_FILE" | head -1)"
    if [ -n "${parsed:-}" ]; then last="$parsed"; fi
  fi
  if [ "$step" = "error" ]; then
    if [ "$last" -gt 0 ]; then percent="$last"; fi
  elif [ "$percent" -lt "$last" ]; then
    percent="$last"
  fi
  echo "==> [${percent}%] ${step}${detail:+ – $detail}"
  printf 'percent=%s\nstep=%s\ndetail=%s\n' "$percent" "$step" "$detail" > "$PROGRESS_FILE"
  mirror_progress
}

watch_compose_log() {
  pid="$1"
  logf="$2"
  while kill -0 "$pid" 2>/dev/null; do
    log="$(tail -c 16000 "$logf" 2>/dev/null || true)"
    case "$log" in
      *"Container cloudora"*"Healthy"*) write_progress 94 startWeb "Container healthy" ;;
      *"Container cloudora"*"Started"*) write_progress 90 startWeb "Container starting" ;;
      *"Image cloudora Built"*|*"naming to"*"cloudora"*) write_progress 80 buildWeb "Image built" ;;
      *"exporting to image"*) write_progress 72 export "Exporting image" ;;
      *"Compiled successfully"*) write_progress 64 buildWeb "Web compiled" ;;
      *"cloudora Building"*|*" Building web"*|*" Building cloudora"*) write_progress 42 buildWeb "Building image" ;;
    esac
    sleep 1
  done
}

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing command: $1" >&2; exit 1; }
}

valid_release_tag() {
  echo "$1" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+$'
}

pick_latest_semver() {
  awk '
    /^v?[0-9]+\.[0-9]+\.[0-9]+$/ {
      t = $0
      v = t
      sub(/^v/, "", v)
      n = split(v, a, ".")
      if (n < 3) next
      maj = a[1] + 0; min = a[2] + 0; pat = a[3] + 0
      if (best == "" || maj > bm || (maj == bm && min > bn) || (maj == bm && min == bn && pat > bp)) {
        bm = maj; bn = min; bp = pat; best = t
      }
    }
    END { if (best != "") print best }
  '
}

github_html_latest_tag() {
  wget -qS --spider -T 20 -U "cloudora-self-update" \
    "https://github.com/${REPO}/releases/latest" 2>&1 \
    | tr -d '\r' \
    | sed -n 's/.*\/releases\/tag\/\([^[:space:]]*\).*/\1/p' \
    | head -1
}

github_git_latest_tag() {
  tags=""
  if command -v git >/dev/null 2>&1; then
    tags="$(git ls-remote --tags --refs "$CLONE_URL" 2>/dev/null | awk '{print $2}' | sed 's|refs/tags/||' || true)"
  fi
  if [ -z "$tags" ]; then
    tags="$(wget -qO- -T 20 --header='User-Agent: git/2.43.0' \
      "https://github.com/${REPO}.git/info/refs?service=git-upload-pack" 2>/dev/null \
      | tr -d '\000' | grep -oE 'refs/tags/v?[0-9]+\.[0-9]+\.[0-9]+' | sed 's|refs/tags/||' || true)"
  fi
  printf '%s\n' "$tags" | pick_latest_semver
}

github_api_latest_tag() {
  tok="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [ -n "$tok" ]; then
    wget -qO- -T 20 \
      --header='User-Agent: cloudora-self-update' \
      --header='Accept: application/vnd.github+json' \
      --header="Authorization: Bearer ${tok}" \
      "https://api.github.com/repos/${REPO}/releases/latest"
  else
    wget -qO- -T 20 --header='User-Agent: cloudora-self-update' \
      "https://api.github.com/repos/${REPO}/releases/latest"
  fi 2>/dev/null | tr ',' '\n' | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1
}

resolve_release_tag() {
  best="$(
    printf '%s\n' \
      "$(github_html_latest_tag || true)" \
      "$(github_git_latest_tag || true)" \
      | pick_latest_semver
  )"
  if valid_release_tag "$best"; then echo "$best"; return 0; fi
  best="$(github_api_latest_tag || true)"
  if valid_release_tag "$best"; then echo "$best"; return 0; fi
  if valid_release_tag "$RELEASE_TAG"; then echo "$RELEASE_TAG"; return 0; fi
  if [ -n "$SIGNAL_DIR" ] && [ -f "${SIGNAL_DIR}/target" ]; then
    best="$(tr -d '[:space:]' < "${SIGNAL_DIR}/target")"
    if valid_release_tag "$best"; then echo "$best"; return 0; fi
  fi
  return 1
}

echo "==> Cloudora self-update"
echo " dir=${INSTALL_DIR} repo=${REPO} branch=${BRANCH} skip_compose=${SKIP_COMPOSE}"
write_progress 4 start "Update started"

need wget
need tar
NATIVE=0
if [ "${CLOUDORA_RUNTIME:-}" = "native" ] || [ -f /etc/systemd/system/cloudora.service ]; then
  NATIVE=1
fi
if [ "$NATIVE" = "1" ]; then
  need node
  need npm
elif [ "$SKIP_COMPOSE" != "1" ]; then
  need docker
  docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin required" >&2; exit 1; }
fi

RESOLVED="$(resolve_release_tag || true)"
if [ -n "$RESOLVED" ]; then
  RELEASE_TAG="$RESOLVED"
fi
if [ -z "$RELEASE_TAG" ]; then
  echo "ERROR: could not resolve latest GitHub release" >&2
  write_progress 0 error "Latest GitHub release not found"
  exit 1
fi
TARBALL_URL="https://github.com/${REPO}/archive/refs/tags/${RELEASE_TAG}.tar.gz"
echo " release=${RELEASE_TAG}"

if [ ! -f "${INSTALL_DIR}/package.json" ]; then
  echo "ERROR: package.json missing in ${INSTALL_DIR}" >&2
  exit 1
fi

disk_avail_kb() {
  df -Pk "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}'
}

free_docker_space() {
  percent="${1:-6}"
  echo "==> Cleaning Docker leftovers"
  write_progress "$percent" cleanup "Pruning unused images and build cache"
  docker container prune -f >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  docker image prune -af >/dev/null 2>&1 || true
  avail="$(disk_avail_kb)"
  echo " disk available: ${avail:-?}K"
  if [ "${avail:-0}" -lt 2097152 ]; then
    write_progress 0 error "Not enough disk space (${avail}K free, need 2G+)"
    echo "ERROR: not enough disk space after cleanup (${avail}K free, need at least 2G)" >&2
    exit 1
  fi
}

ensure_git() {
  command -v git >/dev/null 2>&1 && return 0
  if command -v apk >/dev/null 2>&1; then apk add --no-cache git >/dev/null 2>&1 || return 1; fi
  command -v git >/dev/null 2>&1
}

resolve_sha() {
  if command -v git >/dev/null 2>&1; then
    SHA="$(git ls-remote "$CLONE_URL" "refs/tags/${RELEASE_TAG}" | awk '{print $1}' | head -1 || true)"
    if [ -n "${SHA:-}" ]; then echo "$SHA"; return 0; fi
  fi
  SHA="$(wget -qO- --header='User-Agent: git/2.43.0' \
    "https://github.com/${REPO}.git/info/refs?service=git-upload-pack" \
    | tr -d '\000' | grep -oE "[0-9a-f]{40}[[:space:]]+refs/tags/${RELEASE_TAG}" | awk '{print $1}' | head -1 || true)"
  if [ -n "${SHA:-}" ]; then echo "$SHA"; return 0; fi
  echo "ERROR: could not resolve release ${RELEASE_TAG}" >&2
  exit 1
}

sync_via_git() {
  git config --global --add safe.directory "$INSTALL_DIR" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" remote get-url origin >/dev/null 2>&1 || git -C "$INSTALL_DIR" remote add origin "$CLONE_URL" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" remote set-url origin "$CLONE_URL" >/dev/null 2>&1 || true
  git -C "$INSTALL_DIR" fetch --force --depth 1 origin "refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}"
  REMOTE="$(git -C "$INSTALL_DIR" rev-parse "${RELEASE_TAG}" 2>/dev/null || git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)"
  if [ -z "${REMOTE:-}" ]; then
    echo "ERROR: fetch did not return a revision" >&2
    return 1
  fi
  echo "==> Local changes that will be overwritten (except .env / storage / progress files):"
  git -C "$INSTALL_DIR" status --porcelain --untracked-files=no | grep -vE '^\s*\.env$|^\s*\.cloudora-' || true
  git -C "$INSTALL_DIR" reset --hard "$REMOTE"
  git -C "$INSTALL_DIR" clean -fd \
    -e .env \
    -e storage \
    -e storage/ \
    -e .cloudora-revision \
    -e .cloudora-update-progress \
    -e .cloudora-update-compose.log \
    -e .cloudora-update.lock
  echo " git reset to $REMOTE ($RELEASE_TAG)"
}

sync_via_tarball() {
  echo "==> Downloading source tarball"
  wget -qO "$TMP/src.tgz" "$TARBALL_URL"
  tar -xzf "$TMP/src.tgz" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d ! -name '.' | head -1)"
  echo "==> Syncing files (preserving .env, storage/, .git)"
  cd "$SRC"
  tar cf - \
    --exclude='./.env' \
    --exclude='./storage' \
    --exclude='./.cloudora-revision' \
    --exclude='./.cloudora-update-progress' \
    --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./.next' \
    . | (cd "$INSTALL_DIR" && tar xf -)
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$LOCK_DIR"' EXIT

if [ "$SKIP_COMPOSE" != "1" ]; then
  free_docker_space 6
fi

echo "==> Resolving remote revision"
write_progress 8 resolve "Reading remote revision"
ensure_git || true
SHA="$(resolve_sha)"
echo " remote=$SHA"
write_progress 12 resolve "Remote revision resolved"

if [ -d "${INSTALL_DIR}/.git" ] && ensure_git && sync_via_git; then
  echo "==> Git sync complete"
  SHA="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  write_progress 22 sync "Source synced"
else
  write_progress 16 sync "Downloading source"
  sync_via_tarball
  write_progress 22 sync "Source synced"
fi

if [ "$NATIVE" = "1" ]; then
  echo "==> Native rebuild"
  write_progress 28 deps "npm ci"
  cd "$INSTALL_DIR"
  npm ci
  write_progress 50 migrate "Prisma migrate"
  npx prisma generate
  npx prisma migrate deploy
  write_progress 70 buildWeb "next build"
  npm run build
  mkdir -p .next/standalone/.next
  rm -rf .next/standalone/.next/static
  cp -a .next/static .next/standalone/.next/static
  write_progress 90 startWeb "systemctl restart"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart cloudora || true
  fi
  printf '%s\n' "$SHA" > "${INSTALL_DIR}/.cloudora-revision"
  write_progress 100 done "Native update complete"
  echo "==> Done. Cloudora native service restarted."
  exit 0
fi

if [ "$SKIP_COMPOSE" = "1" ]; then
  printf '%s\n' "$SHA" > "${INSTALL_DIR}/.cloudora-revision"
  if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ]; then
    printf '%s\n' "$SHA" > "${SIGNAL_DIR}/.cloudora-revision"
  fi
  echo " wrote .cloudora-revision"
  write_progress 100 done "Files updated"
  echo "==> Done. Restart Cloudora if it does not hot-reload."
  exit 0
fi

echo "==> Rebuilding stack (docker compose up -d --build)"
write_progress 26 cleanup "Freeing space before rebuild"
free_docker_space 26
write_progress 28 build "Stack rebuild starting"
cd "$INSTALL_DIR"
if [ -S /var/run/docker.sock ]; then
  unset DOCKER_HOST
fi
export COMPOSE_BAKE=false
COMPOSE_FILE="docker-compose.yml"
if [ -f docker-compose.prod.yml ]; then COMPOSE_FILE="docker-compose.prod.yml"; fi
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans > "$TMP/compose.log" 2>&1 &
CPID=$!
watch_compose_log "$CPID" "$TMP/compose.log" &
WATCH=$!
set +e
wait "$CPID"
COMPOSE_RC=$?
set -e
kill "$WATCH" 2>/dev/null || true
wait "$WATCH" 2>/dev/null || true
cat "$TMP/compose.log" || true
cp "$TMP/compose.log" "$COMPOSE_LOG_FILE" 2>/dev/null || true
if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ]; then
  cp "$TMP/compose.log" "${SIGNAL_DIR}/.cloudora-update-compose.log" 2>/dev/null || true
fi
if [ "$COMPOSE_RC" -ne 0 ]; then
  if grep -q 'unable to upgrade to tcp' "$TMP/compose.log"; then
    err="Docker-Socket-Proxy blockiert den Image-Build (403). Einmal auf dem Host: docker compose -f docker-compose.prod.yml up -d --build --remove-orphans"
  else
    err="$(grep -Ei 'ERROR|error:|failed|ELIFECYCLE|no space|forbidden' "$TMP/compose.log" | grep -viE 'COMPOSE_BAKE|better performances' | tail -1 | tr '\n' ' ' | cut -c1-180)"
  fi
  if [ -z "$err" ]; then
    err="$(tail -8 "$TMP/compose.log" | grep -viE 'COMPOSE_BAKE|better performances' | tr '\n' ' ' | cut -c1-180)"
  fi
  write_progress 0 error "${err:-Compose rebuild failed}"
  echo "ERROR: compose rebuild failed (see ${COMPOSE_LOG_FILE})" >&2
  exit "$COMPOSE_RC"
fi

printf '%s\n' "$SHA" > "${INSTALL_DIR}/.cloudora-revision"
if [ -n "$SIGNAL_DIR" ] && [ -d "$SIGNAL_DIR" ]; then
  printf '%s\n' "$SHA" > "${SIGNAL_DIR}/.cloudora-revision"
fi
echo " wrote .cloudora-revision"
write_progress 96 finalize "Revision saved"
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -af >/dev/null 2>&1 || true
write_progress 100 done "Update complete"
echo "==> Done. Cloudora should come back shortly."
