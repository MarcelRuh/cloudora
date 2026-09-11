import path from "node:path";
import { AppError } from "@/lib/errors";
import { assertSafeFileName } from "@/server/storage/path-resolver";

const MAX_PATH = 512;

export function isAbsolutePosixPath(value: string): boolean {
  return value.startsWith("/");
}

/** Normalizes an admin-configured filesystem path. Absolute (`/home`) or relative (`users/anna`). */
export function normalizeConfiguredPath(input: string, fallback = ""): string {
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw) return fallback;
  if (raw.length > MAX_PATH) {
    throw new AppError("INVALID_PATH", "Der Pfad ist zu lang.", 400);
  }
  if (raw.includes("\0") || raw.includes("%00") || raw.includes("://") || raw.startsWith("//")) {
    throw new AppError("PATH_TRAVERSAL", "Der Pfad ist ungültig.", 400);
  }
  if (raw.startsWith("~") || raw.includes(":")) {
    throw new AppError("INVALID_PATH", "Nur POSIX-Pfade sind erlaubt.", 400);
  }
  const absolute = raw.startsWith("/");
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (parts.length === 0) {
    throw new AppError("INVALID_PATH", "Wurzel / ist nicht erlaubt. Nutze z. B. /home.", 400);
  }
  for (const part of parts) {
    if (part === ".." || part.includes("\0")) {
      throw new AppError("PATH_TRAVERSAL", "Path-Traversal ist nicht erlaubt.", 400);
    }
    assertSafeFileName(part);
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined;
}

export function joinConfigured(base: string, name: string): string {
  const safe = assertSafeFileName(name);
  const trimmed = base.replace(/\/+$/, "");
  if (isAbsolutePosixPath(trimmed)) return `${trimmed}/${safe}`;
  return trimmed ? `${trimmed}/${safe}` : safe;
}

export function resolveConfiguredPath(configured: string, storageRootAbs: string): string {
  if (isAbsolutePosixPath(configured)) return path.resolve(configured);
  return path.resolve(storageRootAbs, configured);
}
