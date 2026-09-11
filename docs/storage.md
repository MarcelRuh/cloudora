# Storage

Admins edit paths in **Administration → Speicher** and per-user homes in **Benutzer**. Changes are stored in the database (key `storage.paths`) and override `.env` at runtime.

## Storage root

Absolute path **inside** the process/container. Examples: `/storage`, `/home`, `/mnt/data`.

Administrators browse this root. Docker: the path must exist in the container (bind-mount).

`CLOUDORA_HOST_STORAGE` (default `./storage`) is the **host** path Compose bind-mounts onto `CLOUDORA_STORAGE_PATH` (default `/storage`). That can be the install disk, an NFS share, a USB disk, or a hypervisor bind (Proxmox/LXC/…). If it already *is* your data disk, do not link the same path again as an extra volume.

Additional host folders besides the main bind: **Administration → Speicher → Host-Ordner**. Each chosen path (e.g. `/mnt/nas`, `/media/usb`, `/srv/daten`) is bind-mounted read-write and shows in the explorer under `/volumes/{id}` with a disk icon. Cloudora writes `docker-compose.cloudora-volumes.yml`; the sidecar recreates only the `cloudora` service (`docker compose up -d --no-build --no-deps cloudora`).

To use the host `/home` directory:

```yaml
# docker-compose.override.yml
services:
  cloudora:
    volumes:
      - /home:/home
```

Then set Storage-Root or a user Home-Pfad to `/home`.

## Extra volumes

Admins link additional host directories in **Administration → Speicher → Host-Ordner**. Any host path works (`/mnt/hdd`, `/media/usb`, `/home/data`, …). Cloudora writes `docker-compose.cloudora-volumes.yml` and the sidecar applies it. Linked folders appear in the explorer under `/volumes/{id}` labeled as host folders.

The path picker tab **Linux /** lists the **host** root via a read-only bind `/:/host`. You can pick `/mnt/hdd`, `/home`, … — not `/` itself.

## User homes

`homePath` may be:

- Absolute: `/home`, `/home/anna`, `/mnt/nas/photos`
- Relative to the storage root: `users/anna`

The user sees that directory as virtual `/`. `..` and symlink escapes are rejected. `/` alone is not allowed.

Default for new users: `{usersDir}/{username}` (if `usersDir` is `/home`, that becomes `/home/anna`).

Virtual listing paths stay POSIX `/…`. File APIs never return absolute paths to regular clients.

Quotas (`quotaBytes`, `null` = unlimited) are enforced on upload/copy/edit. Used bytes live on `User.usedBytes` and can be recomputed by walking the home directory.

The `FileIndex` table speeds search and dashboard counts; the filesystem remains the source of truth for listings.
