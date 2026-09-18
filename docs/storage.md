# Storage

Admins edit the app storage root and user homes in **Administration → Speicher**. Explorer folders are **Ordnerfreigaben** (Samba-style named shares with read/write grants).

## Ordnerfreigaben

Each share has:

- Display name and slug (virtual path `/slug`)
- Absolute host path (e.g. `/mnt/cloudora`)
- Grants: role or user, `READ` or `WRITE`, optional `subPath` relative to the share (empty = entire share)

A grant on `/mnt/cloudora/shared/test` (subPath `shared/test`) shows only that folder in the explorer. Parent folders like `shared` stay hidden.

Administrators always have write access to the full share. The explorer root lists only granted folders, plus **Home** if the user has a home path enabled. `/mnt`, `/media` and `/srv` are not injected automatically.

Virtual listing paths stay POSIX `/…`. File APIs never return absolute paths to regular clients. Admins may see the host path on a share badge.

## Storage root

Absolute path of the process. Native examples: `/opt/cloudora/storage`, `/home/cloudora/storage`. Used for trash, default homes, and indexes — not as the explorer catalog.

`CLOUDORA_STORAGE_PATH` is that path. `CLOUDORA_HOST_STORAGE` is the display/compose counterpart.

## User homes

`homePath` may be:

- Absolute: `/home/anna`, `/mnt/nas/photos`
- Relative to the storage root: `users/anna`

Shown in the explorer as `/Home` when `homePathEnabled` is true.

Default for new users: `{usersDir}/{username}`.

Quotas (`quotaBytes`, `null` = unlimited) are enforced on upload/copy/edit.
