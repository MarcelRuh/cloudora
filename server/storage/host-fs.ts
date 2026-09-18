import fs from "node:fs";
import path from "node:path";

const BLOCKED_PREFIXES = ["/proc", "/sys", "/dev", "/run"];

export function isBlockedSystemPath(absPath: string): boolean {
  const normalized = path.resolve(absPath);
  return BLOCKED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function isWritableDir(absPath: string): boolean {
  try {
    fs.accessSync(absPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Host path the process opens — native, no /host remap. */
export function toFilesystemPath(displayPath: string): string {
  const raw = displayPath.replace(/\\/g, "/").trim() || "/";
  return path.resolve(raw.startsWith("/") ? raw : `/${raw}`);
}

/** Process path shown in the picker. */
export function toDisplayPath(fsPath: string): string {
  return path.resolve(fsPath);
}
