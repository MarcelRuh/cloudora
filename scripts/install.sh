#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${CLOUDORA_REPO_URL:-https://github.com/MarcelRuh/cloudora.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${SOURCE_ROOT}/docker-compose.yml" && -f "${SOURCE_ROOT}/package.json" ]]; then
  DEFAULT_DIR="${SOURCE_ROOT}"
else
  DEFAULT_DIR="/opt/cloudora"
fi

DIR="${CLOUDORA_DIR:-$DEFAULT_DIR}"

log() { echo "==> $*"; }
die() { echo "Fehler: $*" >&2; exit 1; }

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "Dieses Skript muss als root laufen (sudo), damit Docker installiert werden kann."
  fi
}

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl git ca-certificates openssl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl git ca-certificates openssl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl git ca-certificates openssl
  fi
  command -v curl >/dev/null || die "curl fehlt"
  command -v git >/dev/null || die "git fehlt"
  command -v openssl >/dev/null || die "openssl fehlt"
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

install_docker() {
  if docker_ready; then
    log "Docker und Compose sind bereits installiert."
    docker --version
    docker compose version
    return
  fi

  log "Installiere Docker Engine + Compose Plugin…"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
  fi

  curl -fsSL https://get.docker.com | sh

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable docker >/dev/null 2>&1 || true
    systemctl start docker >/dev/null 2>&1 || true
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "get.docker.com hat Docker nicht bereitgestellt, versuche Distro-Pakete…"
    if command -v apt-get >/dev/null 2>&1; then
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq docker.io docker-compose-plugin || apt-get install -y -qq docker.io docker-compose
    fi
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log "Nachinstalliere Docker Compose Plugin…"
    if command -v apt-get >/dev/null 2>&1; then
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq docker-compose-plugin
    fi
  fi

  docker_ready || die "Docker Compose ist nach der Installation nicht verfügbar."
  docker --version
  docker compose version
}

sync_sources() {
  mkdir -p "$(dirname "$DIR")"
  if [[ -d "${DIR}/.git" || -f "${DIR}/docker-compose.yml" ]]; then
    log "Verwende vorhandenes Cloudora-Verzeichnis: ${DIR}"
    cd "$DIR"
    return
  fi
  log "Klone Cloudora nach ${DIR}…"
  git clone "$REPO_URL" "$DIR"
  cd "$DIR"
}

host_storage_from_env() {
  local value="./storage"
  if [[ -f .env ]]; then
    value="$(awk -F= '/^CLOUDORA_HOST_STORAGE=/{v=$2} END{print v}' .env 2>/dev/null || true)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
  fi
  if [[ -n "${CLOUDORA_HOST_STORAGE:-}" ]]; then
    value="$CLOUDORA_HOST_STORAGE"
  fi
  echo "${value:-./storage}"
}

prepare_env() {
  if [[ ! -f .env ]]; then
    cp .env.example .env
    SESSION_SECRET="$(openssl rand -hex 32)"
    ENCRYPTION_KEY="$(openssl rand -hex 32)"
    sed -i "s/change-me-to-a-long-random-session-secret/${SESSION_SECRET}/" .env
    sed -i "s/change-me-to-a-long-random-encryption-key/${ENCRYPTION_KEY}/" .env
    log "SESSION_SECRET und ENCRYPTION_KEY wurden generiert."
    log "Bitte BOOTSTRAP_ADMIN_PASSWORD in .env alsbald ändern."
  fi
  local host_storage
  host_storage="$(host_storage_from_env)"
  mkdir -p "$host_storage"
  log "Storage-Mount: ${host_storage}"
}

start_stack() {
  log "Starte Cloudora mit Docker Compose…"
  docker compose up -d --build
}

print_done() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "Cloudora läuft."
  echo "  Lokal:   http://127.0.0.1:3000"
  if [[ -n "${ip:-}" ]]; then
    echo "  Netzwerk: http://${ip}:3000"
  fi
  echo
  echo "Login: BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD aus .env"
  echo "Passwort nach dem ersten Login ändern."
}

need_root
install_base_packages
install_docker
sync_sources
prepare_env
start_stack
print_done
