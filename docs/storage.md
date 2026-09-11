# Storage

Admins edit paths in **Administration → Speicher** and per-user homes in **Benutzer**. Changes are stored in the database (key `storage.paths`) and override `.env` at runtime.

## Storage root

Absolute path **inside** the process/container. Examples: `/storage`, `/home`, `/mnt/data`.

Administrators browse this root. Docker: the path must exist in the container (bind-mount).

`CLOUDORA_HOST_STORAGE` (default `./storage`) is the host path Compose bind-mounts onto `CLOUDORA_STORAGE_PATH` (default `/storage`). Extra disks: `docker-compose.override.yml`.

To use the host `/home` directory:

```yaml
# docker-compose.override.yml
services:
  cloudora:
    volumes:
      - /home:/home
```

Then set Storage-Root or a user Home-Pfad to `/home`.

## User homes

`homePath` may be:

- Absolute: `/home`, `/home/anna`, `/mnt/nas/photos`
- Relative to the storage root: `users/anna`

The user sees that directory as virtual `/`. `..` and symlink escapes are rejected. `/` alone is not allowed.

Default for new users: `{usersDir}/{username}` (if `usersDir` is `/home`, that becomes `/home/anna`).

Virtual listing paths stay POSIX `/…`. File APIs never return absolute paths to regular clients.

Quotas (`quotaBytes`, `null` = unlimited) are enforced on upload/copy/edit. Used bytes live on `User.usedBytes` and can be recomputed by walking the home directory.

The `FileIndex` table speeds search and dashboard counts; the filesystem remains the source of truth for listings.
