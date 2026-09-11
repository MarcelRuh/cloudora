import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { isInsideStorageRoot, toConfiguredFromAbsolute } from "@/lib/posix-path";
import { assertSafeFileName } from "@/server/storage/path-resolver";

export const MAX_LINUX_ENTRIES = 400;
const BLOCKED = ["/proc", "/sys", "/dev", "/run"];

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
};

function isBlocked(absPath: string): boolean {
  const normalized = path.resolve(absPath);
  return BLOCKED.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function isWritableDir(absPath: string): boolean {
  try {
    fs.accessSync(absPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function safeStatDir(absPath: string): { path: string; readable: boolean } | null {
  try {
    const st = fs.statSync(absPath);
    if (!st.isDirectory()) return null;
    let readable = true;
    try {
      fs.accessSync(absPath, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
      readable = false;
    }
    return { path: path.resolve(absPath), readable };
  } catch {
    return null;
  }
}

export function inspectLinuxStatus(absPath: string): LinuxPathStatus {
  try {
    const st = fs.statSync(absPath);
    return {
      exists: true,
      isDirectory: st.isDirectory(),
      writable: st.isDirectory() ? isWritableDir(absPath) : false,
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
  const abs = path.resolve(raw.startsWith("/") ? raw : `/${raw}`);
  if (isBlocked(abs)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht durchsucht werden.", 403);
  }
  return abs;
}

function resolveAgainstStorage(input: string, storageRoot: string): string {
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw) return path.resolve(storageRoot);
  if (raw.startsWith("/")) return normalizeBrowsePath(raw);
  return normalizeBrowsePath(path.join(storageRoot, raw));
}

export function inspectLinuxPath(inputPath: string, storageRoot: string): LinuxInspectResult {
  const abs = resolveAgainstStorage(inputPath, storageRoot);
  const status = inspectLinuxStatus(abs);
  return {
    path: abs,
    ...status,
    insideVolume: isInsideStorageRoot(abs, storageRoot),
    configured: toConfiguredFromAbsolute(abs, storageRoot, true),
  };
}

export function mkdirLinuxDirectory(parentInput: string, name: string): string {
  const parent = normalizeBrowsePath(parentInput);
  if (parent === "/") {
    throw new AppError("FORBIDDEN", "Unter / kann kein Ordner angelegt werden.", 403);
  }
  const safe = assertSafeFileName(name);
  const target = path.join(parent, safe);
  if (isBlocked(target) || isBlocked(parent)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht verändert werden.", 403);
  }
  const self = safeStatDir(parent);
  if (!self?.readable) {
    throw new AppError("NOT_FOUND", "Elternordner nicht gefunden.", 404);
  }
  if (!isWritableDir(parent)) {
    throw new AppError("FORBIDDEN", "Keine Berechtigung, in diesem Verzeichnis zu schreiben.", 403);
  }
  try {
    fs.mkdirSync(target, { recursive: false });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EEXIST") {
      throw new AppError("CONFLICT", "Dieser Ordner existiert bereits.", 409);
    }
    throw new AppError("FORBIDDEN", "Ordner konnte nicht angelegt werden.", 403);
  }
  return path.resolve(target);
}

export function browseLinuxDirectories(inputPath: string, extraShortcuts: string[] = [], storageRoot = ""): LinuxBrowseResult {
  let current = normalizeBrowsePath(inputPath);
  const self = safeStatDir(current);
  if (!self) {
    current = path.dirname(current);
    if (isBlocked(current)) {
      throw new AppError("NOT_FOUND", "Verzeichnis nicht gefunden.", 404);
    }
  } else {
    current = self.path;
  }

  let real = current;
  try {
    real = fs.realpathSync.native(current);
  } catch {
    real = current;
  }
  if (isBlocked(real)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht durchsucht werden.", 403);
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
      const child = path.join(real, dirent.name);
      if (isBlocked(child)) continue;
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      const info = safeStatDir(child);
      if (!info) continue;
      entries.push({ name: dirent.name, path: info.path, readable: info.readable });
    }
  } catch {
    throw new AppError("FORBIDDEN", "Keine Berechtigung, dieses Verzeichnis zu lesen.", 403);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));

  const shortcutPaths = [...LINUX_SHORTCUTS, ...extraShortcuts.filter(Boolean)];
  const seen = new Set<string>();
  const shortcuts: LinuxDirEntry[] = [];
  for (const shortcut of shortcutPaths) {
    const info = safeStatDir(shortcut);
    if (!info || seen.has(info.path)) continue;
    seen.add(info.path);
    shortcuts.push({ name: shortcut.startsWith("/") ? shortcut : info.path, path: info.path, readable: info.readable });
  }

  return {
    path: real,
    parent: real === "/" ? null : path.dirname(real),
    writable: isWritableDir(real),
    truncated,
    insideVolume: storageRoot ? isInsideStorageRoot(real, storageRoot) : false,
    entries,
    shortcuts,
  };
}
