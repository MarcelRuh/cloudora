# Deployment

Native systemd: Node.js 22, PostgreSQL 16, `cloudora.service`.

`scripts/install.sh` als root:

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

Setze `PUBLIC_URL` auf den NPM-Hostnamen (`https://cloud.example.com`). `TRUST_PROXY=true` behalten.

Beim Start:

1. Legt `{CLOUDORA_STORAGE_PATH}/{users,shared}` an
2. Führt `prisma migrate deploy` aus
3. Seedet den Bootstrap-Admin falls fehlend
4. Startet Next.js auf Port 3000

## Nginx Proxy Manager

- Scheme: http
- Forward hostname: Host-IP
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

| Daten | Pfad |
| --- | --- |
| Datenbank | lokale PostgreSQL |
| Dateien | `${CLOUDORA_STORAGE_PATH}` |
| Secrets | `.env` |

Updates ersetzen den Code. `.env`, PostgreSQL und der Storage-Ordner bleiben.
