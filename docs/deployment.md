# Deployment

Native systemd ist der Standard. Docker Compose bleibt optional.

## Native (systemd)

`scripts/install.sh` installiert Node.js 22, PostgreSQL und eine `cloudora.service`. Als root:

```bash
wget -qO- https://raw.githubusercontent.com/MarcelRuh/cloudora/main/scripts/install.sh | bash
```

Aus einem Checkout:

```bash
sudo bash scripts/install.sh
```

Setze `CLOUDORA_INSTALL_DIR` auf das Checkout (Standard: aktuelles Repo oder `/opt/cloudora`). Das steht in `.env` und wird für Self-Update gebraucht.

Self-Update in der UI ruft `scripts/self-update-apply.sh` auf, baut nativ und macht `systemctl restart cloudora`.

```bash
systemctl status cloudora
curl -sS http://127.0.0.1:3000/api/health
```

## Docker Compose

```bash
sudo env CLOUDORA_INSTALL_MODE=docker bash scripts/install.sh
```

Oder manuell:

```bash
cp .env.example .env
docker compose up -d --build
```

Production overlay: `docker-compose.prod.yml`.

Der App-Container bekommt **kein** `docker.sock`. Self-Update läuft über den Sidecar `cloudora-updater`, nachdem die UI eine Signaldatei schreibt.

Setze `PUBLIC_URL` auf den NPM-Hostnamen (`https://cloud.example.com`). `TRUST_PROXY=true` behalten.

Der Container:

1. Legt `{CLOUDORA_STORAGE_PATH}/{users,shared}` an (Ordnernamen konfigurierbar)
2. Führt `prisma migrate deploy` aus
3. Seedet den Bootstrap-Admin falls fehlend
4. Startet Next.js auf Port 3000

## Nginx Proxy Manager

- Scheme: http
- Forward hostname: Host-IP (native) oder `cloudora` (Compose-Service)
- Forward port: `3000`
- Websockets: off
- SSL: NPM-Zertifikat
- HTTP/2 optional
- Advanced:

```nginx
client_max_body_size 0;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

## Persistence

| Daten | Native | Docker |
| --- | --- | --- |
| Datenbank | lokale PostgreSQL | Volume `postgres_data` |
| Dateien | `${CLOUDORA_STORAGE_PATH}` | `${CLOUDORA_HOST_STORAGE}` → `${CLOUDORA_STORAGE_PATH}` |
| Secrets | `.env` | `.env` |

Nicht über den App-Code bind-mounten. Updates ersetzen den Code, Volumes und `.env` bleiben.
