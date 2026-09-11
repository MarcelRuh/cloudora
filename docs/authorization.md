# Authorization

Checks always run on the server. Hiding a button is not a control.

## Roles

- **Administrator** (`slug=administrator`): all permissions, including `storage.global`
- **Benutzer** (`slug=user`): file/folder/share/download permissions only

## Extra flags per user

`canUpload`, `canDownload`, `canDelete`, `canEdit`, `canShare`, `canOneTimeDownload`

Administrators ignore flags. Regular users need **both** the role permission and the flag.

## Home path

If `homePathEnabled` is true, the jail root is `{CLOUDORA_STORAGE_PATH}/{homePath}`. Virtual `/` is that directory. `..` and symlink escapes are rejected. `homePath` is relative to the storage root (a host mount or extra bind under that root).

If disabled:

- Administrators see the full storage tree
- Users see `/shared` only
