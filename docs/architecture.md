# Architecture

Cloudora is a Next.js 16 App Router application with PostgreSQL (Prisma) for metadata and a local filesystem backend for blobs.

```text
Internet
  → Nginx Proxy Manager (TLS)
    → Host:3000 (Next.js, systemd cloudora.service)
      → PostgreSQL
      → CLOUDORA_STORAGE_PATH (files)
```

## Layers

- `app/` UI and Route Handlers
- `components/` React UI (Explorer, Formator, Admin)
- `lib/` shared types, permissions, formatting
- `server/` auth, storage jail, services
- `prisma/` schema and migrations

## Data

PostgreSQL stores users, roles, sessions, shares, one-time downloads, trash metadata, rate-limit counters, settings, audit logs, and a filename index. File bytes never enter the database. Deleted files live under `{storageRoot}/.trash/{userId}/` until restore or purge.

## Future backends

`server/storage/backend.ts` defines the storage interface. v1 implements local disk only. S3, WebDAV, and versioning can plug in without changing the Explorer contract (virtual paths).
