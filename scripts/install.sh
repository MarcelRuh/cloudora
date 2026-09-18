#!/usr/bin/env bash
# Cloudora installer — native Node.js + PostgreSQL + systemd.
#
# wget -qO- https://raw.githubusercontent.com/MarcelRuh/cloudora/main/scripts/install.sh | bash
set -euo pipefail

REPO_URL="${CLOUDORA_REPO_URL:-https://github.com/MarcelRuh/cloudora.git}"

# wget|bash setzt BASH_SOURCE nicht (und $0 ist oft "main").
SOURCE_ROOT=""
_src="${BASH_SOURCE[0]:-}"
if [[ -n "$_src" && -f "$_src" && "$_src" != /dev/fd/* && "$_src" != /proc/self/fd/* ]]; then
  SOURCE_ROOT="$(cd "$(dirname "$_src")/.." && pwd)"
elif [[ -f "${PWD}/package.json" && -f "${PWD}/scripts/install.sh" ]]; then
  SOURCE_ROOT="$PWD"
fi

if [[ -n "$SOURCE_ROOT" && -f "${SOURCE_ROOT}/package.json" ]]; then
  DEFAULT_DIR="${SOURCE_ROOT}"
else
  DEFAULT_DIR="/opt/cloudora"
fi

DIR="${CLOUDORA_DIR:-$DEFAULT_DIR}"

log() { echo "==> $*"; }
die() { echo "Fehler: $*" >&2; exit 1; }

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "Dieses Skript muss als root laufen (sudo)."
  fi
}

env_get() {
  local key="$1" fallback="${2:-}"
  local value=""
  if [[ -f .env ]]; then
    value="$(awk -F= -v k="$key" '$1==k {sub(/^[^=]+=/, ""); print; exit}' .env 2>/dev/null || true)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
  fi
  echo "${value:-$fallback}"
}

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq wget git ca-certificates openssl curl build-essential python3 sudo
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y wget git ca-certificates openssl curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y wget git ca-certificates openssl curl
  fi
  command -v wget >/dev/null || die "wget fehlt"
  command -v git >/dev/null || die "git fehlt"
  command -v openssl >/dev/null || die "openssl fehlt"
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [[ "$major" -ge 20 ]]; then
      log "Node.js $(node -v)"
      return
    fi
  fi
  log "Installiere Node.js 22…"
  if command -v apt-get >/dev/null 2>&1; then
    wget -qO- https://deb.nodesource.com/setup_22.x | bash -
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq nodejs
  else
    die "Node.js 22 manuell installieren."
  fi
  command -v node >/dev/null || die "Node.js fehlt"
  command -v npm >/dev/null || die "npm fehlt"
}

install_postgres() {
  if command -v psql >/dev/null 2>&1 && systemctl is-active --quiet postgresql 2>/dev/null; then
    log "PostgreSQL läuft bereits."
    return
  fi
  log "Installiere PostgreSQL…"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq postgresql postgresql-contrib
  else
    die "PostgreSQL manuell installieren."
  fi
  systemctl enable --now postgresql
  local i
  for i in $(seq 1 30); do
    if as_postgres pg_isready -q 2>/dev/null; then
      break
    fi
    sleep 1
  done
  as_postgres pg_isready -q 2>/dev/null || die "PostgreSQL ist nach der Installation nicht erreichbar."
}

# Root-LXCs haben oft kein sudo; runuser/su reichen.
as_postgres() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres "$@"
  elif [[ "$(id -u)" -eq 0 ]]; then
    su -s /bin/sh postgres -c "$*"
  else
    die "Kann nicht als Benutzer postgres ausführen (runuser/sudo fehlen)."
  fi
}

sync_sources() {
  mkdir -p "$(dirname "$DIR")"
  if [[ -d "${DIR}/.git" || -f "${DIR}/package.json" ]]; then
    log "Verwende vorhandenes Cloudora-Verzeichnis: ${DIR}"
    cd "$DIR"
    return
  fi
  log "Klone Cloudora nach ${DIR}…"
  git clone "$REPO_URL" "$DIR"
  cd "$DIR"
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
  if ! grep -q '^CLOUDORA_INSTALL_DIR=' .env 2>/dev/null; then
    echo "CLOUDORA_INSTALL_DIR=${DIR}" >> .env
  fi
  # Docker-Reste: /storage im Container, echter Pfad in CLOUDORA_HOST_STORAGE.
  local storage hostst
  storage="$(env_get CLOUDORA_STORAGE_PATH "")"
  hostst="$(env_get CLOUDORA_HOST_STORAGE "")"
  if [[ -z "$storage" || "$storage" == "/storage" || "$storage" == "./storage" ]]; then
    if [[ "$hostst" == /* && "$hostst" != "/storage" ]]; then
      storage="$hostst"
    else
      storage="${DIR}/storage"
    fi
  fi
  if grep -q '^CLOUDORA_STORAGE_PATH=' .env; then
    sed -i "s|^CLOUDORA_STORAGE_PATH=.*|CLOUDORA_STORAGE_PATH=${storage}|" .env
  else
    echo "CLOUDORA_STORAGE_PATH=${storage}" >> .env
  fi
  if grep -q '^CLOUDORA_HOST_STORAGE=' .env; then
    sed -i "s|^CLOUDORA_HOST_STORAGE=.*|CLOUDORA_HOST_STORAGE=${storage}|" .env
  else
    echo "CLOUDORA_HOST_STORAGE=${storage}" >> .env
  fi
  if grep -q '^CLOUDORA_RUNTIME=' .env; then
    sed -i 's/^CLOUDORA_RUNTIME=.*/CLOUDORA_RUNTIME=native/' .env
  fi
  if grep -q '^CLOUDORA_HOST_ROOT=' .env; then
    sed -i '/^CLOUDORA_HOST_ROOT=/d' .env
  fi
  mkdir -p "$storage"
  chmod +x scripts/*.sh 2>/dev/null || true
}

setup_postgres_db() {
  local db_user db_pass db_name
  db_user="$(env_get POSTGRES_USER cloudora)"
  db_pass="$(env_get POSTGRES_PASSWORD cloudora)"
  db_name="$(env_get POSTGRES_DB cloudora)"
  log "Lege PostgreSQL-Datenbank ${db_name} an…"
  as_postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${db_user}') THEN
    CREATE ROLE ${db_user} LOGIN PASSWORD '${db_pass}';
  ELSE
    ALTER ROLE ${db_user} WITH LOGIN PASSWORD '${db_pass}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${db_name} OWNER ${db_user}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db_name}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${db_name} TO ${db_user};
SQL
  if grep -q '^DATABASE_URL=' .env; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${db_user}:${db_pass}@127.0.0.1:5432/${db_name}?schema=public|" .env
  else
    echo "DATABASE_URL=postgresql://${db_user}:${db_pass}@127.0.0.1:5432/${db_name}?schema=public" >> .env
  fi
}

install_systemd() {
  local unit="/etc/systemd/system/cloudora.service"
  sed "s|/opt/cloudora|${DIR}|g" "${DIR}/scripts/cloudora.service" > "$unit"
  chmod +x "${DIR}/scripts/cloudora-run.sh"
  systemctl daemon-reload
  systemctl enable cloudora
}

start_native() {
  log "Installiere npm-Abhängigkeiten und baue Cloudora…"
  cd "$DIR"
  npm ci
  npx prisma generate
  npx prisma migrate deploy
  npx prisma db seed
  npm run build
  mkdir -p .next/standalone/.next
  rm -rf .next/standalone/.next/static
  cp -a .next/static .next/standalone/.next/static
  install_systemd
  systemctl restart cloudora
  sleep 1
  systemctl --no-pager --full status cloudora | head -20 || true
}

print_done() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "Cloudora läuft (native systemd)."
  echo "  Lokal:   http://127.0.0.1:3000"
  if [[ -n "${ip:-}" ]]; then
    echo "  Netzwerk: http://${ip}:3000"
  fi
  echo
  echo "Login: BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD aus .env"
  echo "Passwort nach dem ersten Login ändern."
  echo "Ordnerfreigaben: Administration → Speicher → Ordnerfreigaben"
}

need_root
install_base_packages
sync_sources
prepare_env
install_node
install_postgres
setup_postgres_db
start_native
print_done
