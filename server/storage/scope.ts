import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { isAdministrator } from "@/lib/permissions";
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
} from "@/server/storage/configured-path";
import { getCachedExtraVolumes, resolveThroughExtraVolumes } from "@/server/storage/extra-volumes";
import { detectHostRoot, isHostBrowseFsPath, toFilesystemPath } from "@/server/storage/host-fs";
import { type StorageScope } from "@/server/storage/path-resolver";

export { sharedDirName, usersDirName };

export function storageRoot(): string {
  return storageRootAbs();
}

export function ensureStorageLayout(): void {
  mkdirWritable(storageRoot(), "Storage-Root");
  mkdirWritable(resolveUsersDirAbs(), "Benutzer-Ordner");
  mkdirWritable(resolveSharedDirAbs(), "Shared-Ordner");
  mkdirWritable(path.join(storageRoot(), "volumes"), "Volumes");
}

function mkdirWritable(absPath: string, label: string): void {
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
  return resolveThroughExtraVolumes(configured, storageRoot(), getCachedExtraVolumes());
}

export function ensureUserHome(user: Pick<SessionUser, "username" | "homePath" | "homePathEnabled">): void {
  ensureStorageLayout();
  if (user.homePathEnabled) {
    mkdirWritable(absoluteHomePath(user), "Home-Pfad");
  }
}

export function scopeForUser(user: SessionUser): StorageScope {
  ensureUserHome(user);
  if (isAdministrator(user)) {
    return {
      kind: "global",
      jailRoot: storageRoot(),
      rootLabel: "Storage",
    };
  }
  if (user.homePathEnabled) {
    return {
      kind: "home",
      jailRoot: absoluteHomePath(user),
      rootLabel: "Home",
    };
  }
  return {
    kind: "shared",
    jailRoot: resolveSharedDirAbs(),
    rootLabel: "Shared",
  };
}

export function displayHomePath(username: string, homePath: string): string {
  const configured = sanitizeHomeRelPath(homePath, username);
  return isAbsolutePosixPath(configured) ? configured : `/${configured}`;
}
