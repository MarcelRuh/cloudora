export const PERMISSIONS = [
  "files.read",
  "files.upload",
  "files.download",
  "files.edit",
  "files.delete",
  "files.rename",
  "files.move",
  "files.copy",
  "folders.create",
  "folders.rename",
  "folders.delete",
  "folders.move",
  "shares.create",
  "shares.revoke",
  "shares.manage",
  "downloads.create",
  "downloads.delete",
  "downloads.manage",
  "users.view",
  "users.create",
  "users.update",
  "users.delete",
  "roles.view",
  "roles.update",
  "audit.view",
  "settings.view",
  "settings.update",
  "system.view",
  "system.update",
  "storage.global",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

export const USER_PERMISSIONS: Permission[] = [
  "files.read",
  "files.upload",
  "files.download",
  "files.edit",
  "files.delete",
  "files.rename",
  "files.move",
  "files.copy",
  "folders.create",
  "folders.rename",
  "folders.delete",
  "folders.move",
  "shares.create",
  "shares.revoke",
  "downloads.create",
  "downloads.delete",
];

export type PermissionGroupId = "files" | "folders" | "shares" | "downloads" | "access" | "system";

export const PERMISSION_GROUPS: Array<{ id: PermissionGroupId; label: string }> = [
  { id: "files", label: "Dateien" },
  { id: "folders", label: "Ordner" },
  { id: "shares", label: "Freigaben" },
  { id: "downloads", label: "One-Time-Downloads" },
  { id: "access", label: "Benutzer & Rollen" },
  { id: "system", label: "System" },
];

export const PERMISSION_CATALOG: Array<{ id: Permission; group: PermissionGroupId; label: string }> = [
  { id: "files.read", group: "files", label: "Lesen" },
  { id: "files.upload", group: "files", label: "Hochladen" },
  { id: "files.download", group: "files", label: "Herunterladen" },
  { id: "files.edit", group: "files", label: "Bearbeiten" },
  { id: "files.delete", group: "files", label: "Löschen" },
  { id: "files.rename", group: "files", label: "Umbenennen" },
  { id: "files.move", group: "files", label: "Verschieben" },
  { id: "files.copy", group: "files", label: "Kopieren" },
  { id: "folders.create", group: "folders", label: "Erstellen" },
  { id: "folders.rename", group: "folders", label: "Umbenennen" },
  { id: "folders.delete", group: "folders", label: "Löschen" },
  { id: "folders.move", group: "folders", label: "Verschieben" },
  { id: "shares.create", group: "shares", label: "Erstellen" },
  { id: "shares.revoke", group: "shares", label: "Zurückziehen" },
  { id: "shares.manage", group: "shares", label: "Alle verwalten" },
  { id: "downloads.create", group: "downloads", label: "Erstellen" },
  { id: "downloads.delete", group: "downloads", label: "Löschen" },
  { id: "downloads.manage", group: "downloads", label: "Alle verwalten" },
  { id: "users.view", group: "access", label: "Benutzer ansehen" },
  { id: "users.create", group: "access", label: "Benutzer anlegen" },
  { id: "users.update", group: "access", label: "Benutzer ändern" },
  { id: "users.delete", group: "access", label: "Benutzer löschen" },
  { id: "roles.view", group: "access", label: "Rollen ansehen" },
  { id: "roles.update", group: "access", label: "Rollen ändern" },
  { id: "audit.view", group: "system", label: "Audit-Log" },
  { id: "settings.view", group: "system", label: "Einstellungen ansehen" },
  { id: "settings.update", group: "system", label: "Einstellungen ändern" },
  { id: "system.view", group: "system", label: "Systeminformationen" },
  { id: "system.update", group: "system", label: "Cloudora aktualisieren" },
  { id: "storage.global", group: "system", label: "Globaler Speicherzugriff" },
];

export type CapabilityFlag =
  | "canUpload"
  | "canDownload"
  | "canDelete"
  | "canEdit"
  | "canShare"
  | "canOneTimeDownload";

const PERMISSION_FLAGS: Partial<Record<Permission, CapabilityFlag>> = {
  "files.upload": "canUpload",
  "files.download": "canDownload",
  "files.delete": "canDelete",
  "files.edit": "canEdit",
  "files.rename": "canEdit",
  "files.move": "canEdit",
  "files.copy": "canEdit",
  "folders.create": "canEdit",
  "folders.rename": "canEdit",
  "folders.delete": "canDelete",
  "folders.move": "canEdit",
  "shares.create": "canShare",
  "shares.revoke": "canShare",
  "downloads.create": "canOneTimeDownload",
  "downloads.delete": "canOneTimeDownload",
};

export type PermissionHolder = {
  role?: { slug?: string; permissions?: readonly string[] };
  canUpload?: boolean;
  canDownload?: boolean;
  canDelete?: boolean;
  canEdit?: boolean;
  canShare?: boolean;
  canOneTimeDownload?: boolean;
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function sanitizePermissions(values: readonly string[]): Permission[] {
  const set = new Set(values.filter(isPermission));
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}

export function hasPermission(granted: readonly string[] | undefined, required: Permission): boolean {
  return Boolean(granted?.includes(required));
}

export function isAdministrator(holder: PermissionHolder | null | undefined): boolean {
  return holder?.role?.slug === "administrator" || hasPermission(holder?.role?.permissions, "storage.global");
}

export function userHasPermission(holder: PermissionHolder | null | undefined, required: Permission): boolean {
  if (!holder) return false;
  if (!hasPermission(holder.role?.permissions, required)) return false;
  if (isAdministrator(holder)) return true;
  const flag = PERMISSION_FLAGS[required];
  if (!flag) return true;
  return holder[flag] !== false;
}

export function userHasAnyPermission(
  holder: PermissionHolder | null | undefined,
  required: readonly Permission[],
): boolean {
  return required.some((p) => userHasPermission(holder, p));
}
