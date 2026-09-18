import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { isInsideStorageRoot, toConfiguredFromAbsolute } from "@/lib/posix-path";
import { assertSafeFileName } from "@/server/storage/path-resolver";
import { isBlockedSystemPath, isWritableDir, toDisplayPath, toFilesystemPath } from "@/server/storage/host-fs";

export const MAX_LINUX_ENTRIES = 400;

export const LINUX_SHORTCUTS = ["/", "/home", "/mnt", "/media", "/opt", "/var", "/data"];

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
};

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
  const fsPath = toFilesystemPath(displayOrFs);
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
  const display = toDisplayPath(path.resolve(raw.startsWith("/") ? raw : `/${raw}`));
  if (isBlockedSystemPath(display)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht durchsucht werden.", 403);
  }
  return display;
}

function resolveAgainstStorage(input: string, storageRoot: string): string {
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw) return toDisplayPath(path.resolve(storageRoot));
  if (raw.startsWith("/")) return normalizeBrowsePath(raw);
  return normalizeBrowsePath(path.join(storageRoot, raw));
}

export function inspectLinuxPath(inputPath: string, storageRoot: string): LinuxInspectResult {
  const display = resolveAgainstStorage(inputPath, storageRoot);
  const fsPath = toFilesystemPath(display);
  const status = inspectLinuxStatus(fsPath);
  const insideVolume = isInsideStorageRoot(fsPath, storageRoot) || isInsideStorageRoot(display, storageRoot);
  return {
    path: display,
    ...status,
    insideVolume,
    configured: toConfiguredFromAbsolute(display, storageRoot, true),
  };
}

export function mkdirLinuxDirectory(parentInput: string, name: string): string {
  const parentDisplay = normalizeBrowsePath(parentInput);
  if (parentDisplay === "/") {
    throw new AppError("FORBIDDEN", "Unter / kann kein Ordner angelegt werden.", 403);
  }
  const parentFs = toFilesystemPath(parentDisplay);
  const safe = assertSafeFileName(name);
  const targetFs = path.join(parentFs, safe);
  const targetDisplay = toDisplayPath(targetFs);
  if (isBlockedSystemPath(targetDisplay) || isBlockedSystemPath(parentDisplay)) {
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
  return path.posix.join(parentDisplay, safe);
}

export function browseLinuxDirectories(
  inputPath: string,
  extraShortcuts: string[] = [],
  storageRoot = "",
): LinuxBrowseResult {
  let display = normalizeBrowsePath(inputPath);
  let fsPath = toFilesystemPath(display);
  const self = safeStatDir(fsPath);
  if (!self) {
    display = display === "/" ? "/" : path.posix.dirname(display) || "/";
    fsPath = toFilesystemPath(display);
    if (isBlockedSystemPath(display)) {
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
  if (isBlockedSystemPath(real) || isBlockedSystemPath(toDisplayPath(real))) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht durchsucht werden.", 403);
  }
  display = toDisplayPath(real);

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
      if (isBlockedSystemPath(childFs)) continue;
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      const info = safeStatDir(childFs);
      if (!info) continue;
      const childDisplay = toDisplayPath(info.fsPath);
      if (isBlockedSystemPath(childDisplay)) continue;
      entries.push({
        name: dirent.name,
        path: childDisplay,
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
    const info = safeStatDir(toFilesystemPath(displayShortcut));
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
