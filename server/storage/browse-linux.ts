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

export function inspectLinuxPath(
  inputPath: string,
  storageRoot: string,
  binds: VolumeBindHint[] = [],
  hostStorage = "",
): LinuxInspectResult {
  const display = resolveAgainstStorage(inputPath, storageRoot);
  const host = hostRoot();
  const volumeFs = filesystemPathOnHostStorage(display, hostStorage, storageRoot);
  if (volumeFs) {
    const status = inspectLinuxStatus(volumeFs);
    return {
      path: display,
      ...status,
      insideVolume: true,
      configured: toConfiguredFromAbsolute(volumeFs, storageRoot, true),
      hostBrowse: false,
      linked: true,
      live: true,
      volumeId: null,
    };
  }
  const fsPath = toFilesystemPath(display, host);
  const hostBrowse = isHostBrowseFsPath(fsPath, host);
  const bind = matchBind(display, fsPath, binds);
  const base: Omit<LinuxInspectResult, keyof LinuxPathStatus> = {
    path: display,
    insideVolume: isInsideStorageRoot(fsPath, storageRoot) || isInsideStorageRoot(display, storageRoot),
    configured: toConfiguredFromAbsolute(display, storageRoot, true),
    hostBrowse,
    linked: Boolean(bind),
    live: false,
    volumeId: bind?.id ?? null,
  };

  if (bind) {
    const suffix =
      display === bind.hostPath
        ? ""
        : display.startsWith(`${bind.hostPath}/`)
          ? display.slice(bind.hostPath.length)
          : fsPath.startsWith(`${bind.containerPath}/`)
            ? fsPath.slice(bind.containerPath.length)
            : "";
    const boundFs = `${bind.containerPath}${suffix}`;
    const live = isMountPoint(bind.containerPath);
    const status = live ? inspectLinuxStatus(boundFs) : inspectLinuxStatus(display);
    return {
      ...base,
      ...status,
      writable: live ? status.writable : false,
      insideVolume: live || base.insideVolume,
      live,
    };
  }

  const status = inspectLinuxStatus(display);
  return {
    ...base,
    ...status,
    writable: hostBrowse ? false : status.writable,
  };
}

export function mkdirLinuxDirectory(parentInput: string, name: string): string {
  const parentDisplay = normalizeBrowsePath(parentInput);
  if (parentDisplay === "/") {
    throw new AppError("FORBIDDEN", "Unter / kann kein Ordner angelegt werden.", 403);
  }
  const parentFs = toFilesystemPath(parentDisplay, hostRoot());
  const safe = assertSafeFileName(name);
  const targetFs = path.join(parentFs, safe);
  const targetDisplay = toDisplayPath(targetFs, hostRoot());
  if (isBlocked(targetDisplay) || isBlocked(parentDisplay)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht verändert werden.", 403);
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
  return targetDisplay;
}

export function browseLinuxDirectories(inputPath: string, extraShortcuts: string[] = [], storageRoot = ""): LinuxBrowseResult {
  const host = hostRoot();
  let display = normalizeBrowsePath(inputPath);
  let fsPath = toFilesystemPath(display, host);
  const self = safeStatDir(fsPath);
  if (!self) {
    display = display === "/" ? "/" : path.dirname(display);
    fsPath = toFilesystemPath(display, host);
    if (isBlocked(display)) {
      throw new AppError("NOT_FOUND", "Verzeichnis nicht gefunden.", 404);
    }
  } else {
    fsPath = self.fsPath;
    display = toDisplayPath(fsPath, host);
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
  display = toDisplayPath(real, host);

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
      const childDisplay = toDisplayPath(childFs, host);
      if (isBlocked(childDisplay) || isBlockedSystemPath(childFs, host)) continue;
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      const info = safeStatDir(childFs);
      if (!info) continue;
      entries.push({ name: dirent.name, path: toDisplayPath(info.fsPath, host), readable: info.readable });
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
    const info = safeStatDir(toFilesystemPath(displayShortcut, host));
    if (!info || seen.has(displayShortcut)) continue;
    seen.add(displayShortcut);
    shortcuts.push({
      name: displayShortcut,
      path: displayShortcut,
      readable: info.readable,
    });
  }

  return {
    path: display,
    parent: display === "/" ? null : path.posix.dirname(display) || "/",
    writable: isWritableDir(real),
    truncated,
    insideVolume: storageRoot
      ? isInsideStorageRoot(real, storageRoot) || isInsideStorageRoot(display, storageRoot)
      : false,
    entries,
    shortcuts,
  };
}
