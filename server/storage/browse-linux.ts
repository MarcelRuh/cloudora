import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { isInsideStorageRoot, toConfiguredFromAbsolute } from "@/lib/posix-path";
import { assertSafeFileName } from "@/server/storage/path-resolver";
import { detectHostRoot, isBlockedSystemPath, isHostBrowseFsPath, isMountPoint, toDisplayPath, toFilesystemPath } from "@/server/storage/host-fs";
import { filesystemPathOnHostStorage } from "@/server/storage/host-storage";

export const MAX_LINUX_ENTRIES = 400;

export const LINUX_SHORTCUTS = ["/", "/home", "/mnt", "/media", "/storage", "/opt", "/var", "/data"];

export type LinuxDirEntry = {
  name: string;
  path: string;
  readable: boolean;
};

export type LinuxPathStatus = {
  exists: boolean;
  isDirectory: boolean;
  writable: boolean;
};

export type LinuxBrowseResult = {
  path: string;
  parent: string | null;
  writable: boolean;
  truncated: boolean;
  insideVolume: boolean;
  entries: LinuxDirEntry[];
  shortcuts: LinuxDirEntry[];
};

export type LinuxInspectResult = LinuxPathStatus & {
  path: string;
  insideVolume: boolean;
  configured: string;
  /** True when existence was checked through the read-only `/host` browse mount. */
  hostBrowse: boolean;
  /** Extra-volume bind exists for this host path. */
  linked: boolean;
  /** Bind-mount is live in this container. */
  live: boolean;
  volumeId: string | null;
};

export type VolumeBindHint = {
  id: string;
  hostPath: string;
  containerPath: string;
};

function hostRoot() {
  return detectHostRoot();
}

function isBlocked(absPath: string): boolean {
  const host = hostRoot();
  return isBlockedSystemPath(absPath, host) || isBlockedSystemPath(toFilesystemPath(absPath, host), host);
}

function isWritableDir(absPath: string): boolean {
  try {
    fs.accessSync(absPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function safeStatDir(fsPath: string): { fsPath: string; readable: boolean } | null {
  try {
    const st = fs.statSync(fsPath);
    if (!st.isDirectory()) return null;
    let readable = true;
    try {
      fs.accessSync(fsPath, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
      readable = false;
    }
    return { fsPath: path.resolve(fsPath), readable };
  } catch {
    return null;
  }
}

export function inspectLinuxStatus(displayOrFs: string): LinuxPathStatus {
  const fsPath = toFilesystemPath(displayOrFs, hostRoot());
  try {
    const st = fs.statSync(fsPath);
    return {
      exists: true,
      isDirectory: st.isDirectory(),
      writable: st.isDirectory() ? isWritableDir(fsPath) : false,
    };
  } catch {
    return { exists: false, isDirectory: false, writable: false };
  }
}

export function normalizeBrowsePath(input: string): string {
  const raw = (input || "/").replace(/\\/g, "/").trim() || "/";
  if (raw.includes("\0") || raw.includes("%00") || raw.includes("://")) {
    throw new AppError("PATH_TRAVERSAL", "Der Pfad ist ungültig.", 400);
  }
  const parts = raw.split("/");
  if (parts.some((part) => part === "..")) {
    throw new AppError("PATH_TRAVERSAL", "Path-Traversal ist nicht erlaubt.", 400);
  }
  const host = hostRoot();
  const display = toDisplayPath(path.resolve(raw.startsWith("/") ? raw : `/${raw}`), host);
  const fsPath = toFilesystemPath(display, host);
  if (isBlockedSystemPath(display, host) || isBlockedSystemPath(fsPath, host)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht durchsucht werden.", 403);
  }
  return display;
}

function resolveAgainstStorage(input: string, storageRoot: string): string {
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw) return toDisplayPath(path.resolve(storageRoot), hostRoot());
  if (raw.startsWith("/")) return normalizeBrowsePath(raw);
  return normalizeBrowsePath(path.join(storageRoot, raw));
}

function bindSuffix(display: string, fsPath: string, bind: VolumeBindHint): string {
  if (display === bind.hostPath) return "";
  if (display.startsWith(`${bind.hostPath}/`)) return display.slice(bind.hostPath.length);
  if (fsPath === bind.containerPath) return "";
  if (fsPath.startsWith(`${bind.containerPath}/`)) return fsPath.slice(bind.containerPath.length);
  return "";
}

function matchBind(display: string, fsPath: string, binds: VolumeBindHint[]): VolumeBindHint | null {
  return (
    binds.find(
      (bind) =>
        display === bind.hostPath ||
        display.startsWith(`${bind.hostPath}/`) ||
        fsPath === bind.containerPath ||
        fsPath.startsWith(`${bind.containerPath}/`),
    ) ?? null
  );
}

/** Writable/live path for a host display path: extra-volume bind, native mount, else `/host`. */
export function resolveBrowseFsPath(
  display: string,
  storageRoot = "",
  binds: VolumeBindHint[] = [],
  hostStorage = "",
): { fsPath: string; hostBrowse: boolean; bind: VolumeBindHint | null; live: boolean } {
  const host = hostRoot();
  if (storageRoot && hostStorage) {
    const volumeFs = filesystemPathOnHostStorage(display, hostStorage, storageRoot);
    if (volumeFs) {
      return { fsPath: volumeFs, hostBrowse: false, bind: null, live: true };
    }
  }
  const mapped = toFilesystemPath(display, host);
  const bind = matchBind(display, mapped, binds);
  const bindLive = Boolean(bind && !isHostBrowseFsPath(bind.containerPath, host));
  if (bind && bindLive) {
    const boundFs = `${bind.containerPath}${bindSuffix(display, mapped, bind)}`;
    const live = isMountPoint(bind.containerPath) || isWritableDir(boundFs) || Boolean(safeStatDir(boundFs));
    if (live || safeStatDir(boundFs)) {
      return { fsPath: boundFs, hostBrowse: false, bind, live };
    }
  }
  if (!host) {
    return { fsPath: mapped, hostBrowse: false, bind: null, live: Boolean(safeStatDir(mapped)) };
  }
  return {
    fsPath: mapped,
    hostBrowse: isHostBrowseFsPath(mapped, host),
    bind,
    live: Boolean(bind && isMountPoint(bind.containerPath)),
  };
}

export function inspectLinuxPath(
  inputPath: string,
  storageRoot: string,
  binds: VolumeBindHint[] = [],
  hostStorage = "",
): LinuxInspectResult {
  const display = resolveAgainstStorage(inputPath, storageRoot);
  const resolved = resolveBrowseFsPath(display, storageRoot, binds, hostStorage);
  const status = inspectLinuxStatus(resolved.fsPath);
  const insideVolume =
    resolved.live ||
    isInsideStorageRoot(resolved.fsPath, storageRoot) ||
    isInsideStorageRoot(display, storageRoot);
  const configured = toConfiguredFromAbsolute(
    resolved.live && !resolved.hostBrowse ? resolved.fsPath : display,
    storageRoot,
    true,
  );
  return {
    path: display,
    ...status,
    writable: resolved.hostBrowse ? false : status.writable,
    insideVolume,
    configured,
    hostBrowse: resolved.hostBrowse,
    linked: Boolean(resolved.bind) || resolved.live,
    live: resolved.live,
    volumeId: resolved.bind?.id ?? null,
  };
}

export function mkdirLinuxDirectory(
  parentInput: string,
  name: string,
  binds: VolumeBindHint[] = [],
  storageRoot = "",
  hostStorage = "",
): string {
  const parentDisplay = normalizeBrowsePath(parentInput);
  if (parentDisplay === "/") {
    throw new AppError("FORBIDDEN", "Unter / kann kein Ordner angelegt werden.", 403);
  }
  const resolved = resolveBrowseFsPath(parentDisplay, storageRoot, binds, hostStorage);
  const parentFs = resolved.fsPath;
  const safe = assertSafeFileName(name);
  const targetFs = path.join(parentFs, safe);
  const targetDisplay = toDisplayPath(targetFs, hostRoot());
  if (isBlocked(targetDisplay) || isBlocked(parentDisplay)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht verändert werden.", 403);
  }
  if (resolved.hostBrowse) {
    throw new AppError(
      "FORBIDDEN",
      "Dieser Host-Pfad ist nur lesbar. Unter /mnt, /media oder /srv kannst du Ordner direkt anlegen.",
      403,
    );
  }
  const self = safeStatDir(parentFs);
  if (!self?.readable) {
    throw new AppError("NOT_FOUND", "Elternordner nicht gefunden.", 404);
  }
  if (!isWritableDir(parentFs)) {
    throw new AppError("FORBIDDEN", "Keine Berechtigung, in diesem Verzeichnis zu schreiben.", 403);
  }
  try {
    fs.mkdirSync(targetFs, { recursive: false });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EEXIST") {
      throw new AppError("CONFLICT", "Dieser Ordner existiert bereits.", 409);
    }
    throw new AppError("FORBIDDEN", "Ordner konnte nicht angelegt werden.", 403);
  }
  return path.posix.join(parentDisplay, safe);
}

export function browseLinuxDirectories(
  inputPath: string,
  extraShortcuts: string[] = [],
  storageRoot = "",
  binds: VolumeBindHint[] = [],
  hostStorage = "",
): LinuxBrowseResult {
  const host = hostRoot();
  let display = normalizeBrowsePath(inputPath);
  let resolved = resolveBrowseFsPath(display, storageRoot, binds, hostStorage);
  let fsPath = resolved.fsPath;
  const self = safeStatDir(fsPath);
  if (!self) {
    display = display === "/" ? "/" : path.posix.dirname(display) || "/";
    resolved = resolveBrowseFsPath(display, storageRoot, binds, hostStorage);
    fsPath = resolved.fsPath;
    if (isBlocked(display)) {
      throw new AppError("NOT_FOUND", "Verzeichnis nicht gefunden.", 404);
    }
  } else {
    fsPath = self.fsPath;
  }

  let real = fsPath;
  try {
    real = fs.realpathSync.native(fsPath);
  } catch {
    real = fsPath;
  }
  if (isBlockedSystemPath(real, host) || isBlocked(toDisplayPath(real, host))) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht durchsucht werden.", 403);
  }
  if (resolved.hostBrowse || (!resolved.bind && !resolved.live)) {
    display = toDisplayPath(real, host);
  }

  const entries: LinuxDirEntry[] = [];
  let truncated = false;
  try {
    const dirents = fs.readdirSync(real, { withFileTypes: true });
    for (const dirent of dirents) {
      if (entries.length >= MAX_LINUX_ENTRIES) {
        truncated = true;
        break;
      }
      if (!dirent.name || dirent.name.startsWith(".")) continue;
      const childFs = path.join(real, dirent.name);
      const childDisplay = resolved.bind || resolved.live ? path.posix.join(display, dirent.name) : toDisplayPath(childFs, host);
      if (isBlocked(childDisplay) || isBlockedSystemPath(childFs, host)) continue;
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      const info = safeStatDir(childFs);
      if (!info) continue;
      entries.push({
        name: dirent.name,
        path: resolved.bind || resolved.live ? childDisplay : toDisplayPath(info.fsPath, host),
        readable: info.readable,
      });
    }
  } catch {
    throw new AppError("FORBIDDEN", "Keine Berechtigung, dieses Verzeichnis zu lesen.", 403);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));

  const shortcutPaths = [...LINUX_SHORTCUTS, ...extraShortcuts.filter(Boolean)];
  const seen = new Set<string>();
  const shortcuts: LinuxDirEntry[] = [];
  for (const shortcut of shortcutPaths) {
    let displayShortcut = shortcut;
    try {
      displayShortcut = normalizeBrowsePath(shortcut);
    } catch {
      continue;
    }
    const info = safeStatDir(resolveBrowseFsPath(displayShortcut, storageRoot, binds, hostStorage).fsPath);
    if (!info || seen.has(displayShortcut)) continue;
    seen.add(displayShortcut);
    shortcuts.push({
      name: displayShortcut,
      path: displayShortcut,
      readable: info.readable,
    });
  }

  const hostBrowse = isHostBrowseFsPath(real, host);
  return {
    path: display,
    parent: display === "/" ? null : path.posix.dirname(display) || "/",
    writable: !hostBrowse && isWritableDir(real),
    truncated,
    insideVolume:
      resolved.live ||
      (storageRoot
        ? isInsideStorageRoot(real, storageRoot) || isInsideStorageRoot(display, storageRoot)
        : false),
    entries,
    shortcuts,
  };
}
