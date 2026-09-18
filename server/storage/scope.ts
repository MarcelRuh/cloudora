import fs from "node:fs";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/types";
import {
  resolveSharedDirAbs,
  resolveUsersDirAbs,
  sharedDirName,
  storageRootAbs,
  usersDirName,
} from "@/server/storage/config";
import {
  isAbsolutePosixPath,
  joinConfigured,
  normalizeConfiguredPath,
  resolveConfiguredPath,
} from "@/server/storage/configured-path";
import { visibleFoldersForUser, getFolderShares, HOME_VIRTUAL_ROOT } from "@/server/storage/folder-shares";
import { getEnv } from "@/server/env";
import { isHostDataPath } from "@/server/storage/host-data";
import { detectHostRoot, isHostBrowseFsPath, toFilesystemPath } from "@/server/storage/host-fs";
import { type ExtraRoot, type StorageScope } from "@/server/storage/path-resolver";

export { sharedDirName, usersDirName };

export function storageRoot(): string {
  return storageRootAbs();
}

export function ensureStorageLayout(): void {
  mkdirWritable(storageRoot(), "Storage-Root");
  mkdirWritable(resolveUsersDirAbs(), "Benutzer-Ordner");
  mkdirWritable(resolveSharedDirAbs(), "Shared-Ordner");
}

function mkdirWritable(absPath: string, label: string): void {
  if (isHostDataPath(absPath) && getEnv().runtime !== "native") {
    return;
  }
  const host = detectHostRoot();
  const fsPath = toFilesystemPath(absPath, host);
  if (isHostBrowseFsPath(fsPath, host)) {
    return;
  }
  try {
    fs.mkdirSync(absPath, { recursive: true });
  } catch {
    throw new AppError(
      "STORAGE_ERROR",
      `${label} ist nicht erstellbar: ${absPath}. Prüfe Mount und Berechtigungen.`,
      400,
    );
  }
}

export function defaultHomePath(username: string): string {
  return joinConfigured(usersDirName(), username.toLowerCase());
}

export function sanitizeHomeRelPath(input: string, username: string): string {
  return normalizeConfiguredPath(input, defaultHomePath(username));
}

export function validateConfiguredHomePath(homePath: string, username: string): string {
  return normalizeConfiguredPath(homePath, defaultHomePath(username));
}

export function absoluteHomePath(user: Pick<SessionUser, "username" | "homePath">): string {
  const configured = sanitizeHomeRelPath(user.homePath, user.username);
  return resolveConfiguredPath(configured, storageRoot());
}

export function ensureUserHome(user: Pick<SessionUser, "username" | "homePath" | "homePathEnabled">): void {
  ensureStorageLayout();
  if (user.homePathEnabled) {
    mkdirWritable(absoluteHomePath(user), "Home-Pfad");
  }
}

export function extraRootsForUser(user: SessionUser): ExtraRoot[] {
  const roots: ExtraRoot[] = [];
  if (user.homePathEnabled) {
    roots.push({
      virtualRoot: HOME_VIRTUAL_ROOT,
      absRoot: absoluteHomePath(user),
      writable: true,
      label: "Home",
      kind: "home",
    });
  }
  for (const share of getFolderShares()) {
    for (const folder of visibleFoldersForUser(user, share)) {
      roots.push({
        virtualRoot: folder.virtualRoot,
        absRoot: folder.absRoot,
        writable: folder.access === "WRITE",
        label: folder.label,
        kind: "share",
      });
    }
  }
  return roots;
}

export function scopeForUser(user: SessionUser): StorageScope {
  ensureUserHome(user);
  return {
    kind: "global",
    jailRoot: storageRoot(),
    extraRoots: extraRootsForUser(user),
    catalogOnly: true,
    rootLabel: "Dateien",
  };
}

export function displayHomePath(username: string, homePath: string): string {
  const configured = sanitizeHomeRelPath(homePath, username);
  return isAbsolutePosixPath(configured) ? configured : `/${configured}`;
}
