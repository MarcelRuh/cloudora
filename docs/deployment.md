# Deployment

## Install script

`scripts/install.sh` installs Git, curl, **Docker Engine and Compose** when they are missing, then starts the stack. Run as root:

```bash
sudo bash scripts/install.sh
```

## Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

Production overlay: `docker-compose.prod.yml`.

Set `PUBLIC_URL` to the NPM hostname (`https://cloud.example.com`). Keep `TRUST_PROXY=true`.

The container:

1. Creates `{CLOUDORA_STORAGE_PATH}/{users,shared}` (ordnernamen konfigurierbar)
2. Runs `prisma migrate deploy`
3. Seeds the bootstrap admin if missing
4. Starts Next.js on port 3000

## Nginx Proxy Manager

- Scheme: http
- Forward hostname: `cloudora` (compose service) or the host IP
- Forward port: `3000`
- Websockets: off
- SSL: NPM certificate
- HTTP/2 optional

## Persistence

| Data | Location |
| --- | --- |
| Database | Docker volume `postgres_data` |
| Files | `${CLOUDORA_HOST_STORAGE}` → `${CLOUDORA_STORAGE_PATH}` |
| Secrets | `.env` |

Do not bind-mount over `/app`. Updates rebuild the image and keep volumes + `.env`.
