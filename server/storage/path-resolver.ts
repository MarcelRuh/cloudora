import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";

const FORBIDDEN_NAMES = new Set(["", ".", ".."]);

export type StorageScopeKind = "home" | "shared" | "global";

export type ExtraRoot = {
  virtualRoot: string;
  absRoot: string;
  writable: boolean;
  label: string;
  kind: "share" | "home";
};

export type StorageScope = {
  kind: StorageScopeKind;
  /** Absolute jail root. All resolved paths must stay inside this directory. */
  jailRoot: string;
  /** Named trees (folder shares / home) mapped from virtual root → host path. */
  extraRoots?: ExtraRoot[];
  /** If true, only `/` and extraRoots are reachable — not the jail listing. */
  catalogOnly?: boolean;
  /** Label shown as the first breadcrumb. */
  rootLabel: string;
};

export type ResolvedPath = {
  virtualPath: string;
  /** Absolute path after jail + normalization. Never send this to clients. */
  absPath: string;
  name: string;
  parentVirtual: string;
  scope: StorageScope;
};

export function posixJoin(...parts: string[]): string {
  const joined = parts
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  if (joined === "") return "/";
  return joined.startsWith("/") ? joined : `/${joined}`;
}

export function normalizeVirtualPath(input: string | null | undefined): string {
  if (input == null || input === "") return "/";
  if (typeof input !== "string") {
    throw new AppError("INVALID_PATH", "Ungültiger Pfad.", 400);
  }
  if (input.includes("\0") || input.includes("%00")) {
    throw new AppError("PATH_TRAVERSAL", "Der Pfad ist ungültig.", 400);
  }
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = input;
  }
  if (decoded.includes("\0")) {
    throw new AppError("PATH_TRAVERSAL", "Der Pfad ist ungültig.", 400);
  }
  const replaced = decoded.replace(/\\/g, "/");
  if (replaced.includes("://") || replaced.startsWith("//")) {
    throw new AppError("PATH_TRAVERSAL", "Der Pfad ist ungültig.", 400);
  }
  const parts = replaced.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === ".." || part === "..." || part.includes("\0")) {
      throw new AppError("PATH_TRAVERSAL", "Path-Traversal ist nicht erlaubt.", 400);
    }
    if (FORBIDDEN_NAMES.has(part)) {
      throw new AppError("INVALID_PATH", "Ungültiger Pfadbestandteil.", 400);
    }
    if (part === "~" || part.startsWith("~")) {
      throw new AppError("PATH_TRAVERSAL", "Der Pfad ist ungültig.", 400);
    }
    stack.push(part);
  }
  return stack.length === 0 ? "/" : `/${stack.join("/")}`;
}

export function virtualBasename(virtualPath: string): string {
  const normalized = normalizeVirtualPath(virtualPath);
  if (normalized === "/") return "";
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function virtualDirname(virtualPath: string): string {
  const normalized = normalizeVirtualPath(virtualPath);
  if (normalized === "/") return "/";
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx) || "/";
}

export function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return !rel.startsWith(`..${path.sep}`) && rel !== ".." && !rel.startsWith("..");
}

function realOrSelf(absPath: string): string {
  try {
    return fs.realpathSync.native(absPath);
  } catch {
    return absPath;
  }
}

function realExistingAncestor(absPath: string, jailRoot: string): string {
  let current = absPath;
  while (current !== path.dirname(current)) {
    try {
      if (fs.existsSync(/* turbopackIgnore: true */ current)) return fs.realpathSync.native(current);
    } catch {
      /* continue */
    }
    current = path.dirname(current);
  }
  return jailRoot;
}

export function extraRootFor(scope: StorageScope, virtualPath: string): ExtraRoot | null {
  const normalized = normalizeVirtualPath(virtualPath);
  const extras = scope.extraRoots ?? [];
  const matches = extras.filter(
    (root) => normalized === root.virtualRoot || normalized.startsWith(`${root.virtualRoot}/`),
  );
  matches.sort((a, b) => b.virtualRoot.length - a.virtualRoot.length);
  return matches[0] ?? null;
}

export function isExtraRootVirtual(scope: StorageScope, virtualPath: string): boolean {
  const normalized = normalizeVirtualPath(virtualPath);
  return (scope.extraRoots ?? []).some((root) => root.virtualRoot === normalized);
}

export function assertScopeWritable(scope: StorageScope, virtualPath: string): void {
  const normalized = normalizeVirtualPath(virtualPath);
  if (normalized === "/") {
    throw new AppError("FORBIDDEN", "Im Stammverzeichnis können keine Dateien angelegt werden.", 400);
  }
  if (isExtraRootVirtual(scope, normalized)) {
    throw new AppError("FORBIDDEN", "Zugewiesene Ordner selbst können nicht verändert werden.", 400);
  }
  const extra = extraRootFor(scope, normalized);
  if (!extra) {
    throw new AppError("FORBIDDEN", "Zugriff außerhalb des erlaubten Speicherbereichs.", 403);
  }
  if (!extra.writable) {
    throw new AppError("FORBIDDEN", "Dieser Ordner ist nur lesbar.", 403);
  }
}

export function resolveScopedPath(scope: StorageScope, virtualPath: string): ResolvedPath {
  const jailRoot = path.resolve(scope.jailRoot);
  if (!fs.existsSync(/* turbopackIgnore: true */ jailRoot)) {
    fs.mkdirSync(jailRoot, { recursive: true });
  }
  const jailReal = realOrSelf(jailRoot);
  const normalized = normalizeVirtualPath(virtualPath);
  if (normalized === "/.trash" || normalized.startsWith("/.trash/")) {
    throw new AppError("FORBIDDEN", "Der Papierkorb ist nicht direkt erreichbar.", 403);
  }

  const extra = extraRootFor(scope, normalized);
  if (extra) {
    const extraResolved = path.resolve(extra.absRoot);
    const extraExists = fs.existsSync(/* turbopackIgnore: true */ extraResolved);
    const extraReal = extraExists ? realOrSelf(extraResolved) : extraResolved;
    const relative = normalized === extra.virtualRoot ? "" : normalized.slice(extra.virtualRoot.length + 1);
    const absPath = relative ? path.resolve(extraReal, relative) : extraReal;
    if (!isInsideRoot(extraReal, absPath)) {
      throw new AppError("PATH_TRAVERSAL", "Zugriff außerhalb des erlaubten Speicherbereichs.", 403);
    }
    // Missing extra roots always have an existing parent *outside* the root.
    // That is not traversal — the folder simply has not been created yet.
    if (extraExists) {
      const ancestor = realExistingAncestor(absPath, extraReal);
      if (!isInsideRoot(extraReal, ancestor)) {
        throw new AppError("PATH_TRAVERSAL", "Zugriff außerhalb des erlaubten Speicherbereichs.", 403);
      }
    }
    const name =
      normalized === extra.virtualRoot ? extra.label : virtualBasename(normalized) || extra.label;
    if (fs.existsSync(/* turbopackIgnore: true */ absPath)) {
      const real = realOrSelf(absPath);
      if (!isInsideRoot(extraReal, real)) {
        throw new AppError("PATH_TRAVERSAL", "Zugriff außerhalb des erlaubten Speicherbereichs.", 403);
      }
      return {
        virtualPath: normalized,
        absPath: real,
        name,
        parentVirtual: virtualDirname(normalized),
        scope: { ...scope, jailRoot: jailReal },
      };
    }
    return {
      virtualPath: normalized,
      absPath,
      name,
      parentVirtual: virtualDirname(normalized),
      scope: { ...scope, jailRoot: jailReal },
    };
  }

  if (scope.catalogOnly) {
    if (normalized === "/") {
      return {
        virtualPath: "/",
        absPath: jailReal,
        name: scope.rootLabel,
        parentVirtual: "/",
        scope: { ...scope, jailRoot: jailReal },
      };
    }
    throw new AppError("FORBIDDEN", "Dieser Ordner ist nicht freigegeben.", 403);
  }

  const relative = normalized === "/" ? "" : normalized.slice(1);
  const absPath = path.resolve(jailReal, relative);
  if (!isInsideRoot(jailReal, absPath)) {
    throw new AppError("PATH_TRAVERSAL", "Zugriff außerhalb des erlaubten Speicherbereichs.", 403);
  }
  const ancestor = realExistingAncestor(absPath, jailReal);
  if (!isInsideRoot(jailReal, ancestor)) {
    throw new AppError("PATH_TRAVERSAL", "Zugriff außerhalb des erlaubten Speicherbereichs.", 403);
  }
  if (fs.existsSync(/* turbopackIgnore: true */ absPath)) {
    const real = realOrSelf(absPath);
    if (!isInsideRoot(jailReal, real)) {
      throw new AppError("PATH_TRAVERSAL", "Zugriff außerhalb des erlaubten Speicherbereichs.", 403);
    }
    return {
      virtualPath: normalized,
      absPath: real,
      name: virtualBasename(normalized) || scope.rootLabel,
      parentVirtual: virtualDirname(normalized),
      scope: { ...scope, jailRoot: jailReal },
    };
  }
  return {
    virtualPath: normalized,
    absPath,
    name: virtualBasename(normalized) || scope.rootLabel,
    parentVirtual: virtualDirname(normalized),
    scope: { ...scope, jailRoot: jailReal },
  };
}

export function assertSafeFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new AppError("INVALID_NAME", "Ungültiger Dateiname.", 400);
  }
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) {
    throw new AppError("PATH_TRAVERSAL", "Ungültiger Dateiname.", 400);
  }
  if (trimmed.length > 255) {
    throw new AppError("INVALID_NAME", "Der Dateiname ist zu lang.", 400);
  }
  return trimmed;
}

export function childVirtual(parent: string, name: string): string {
  const safe = assertSafeFileName(name);
  const base = normalizeVirtualPath(parent);
  return base === "/" ? `/${safe}` : `${base}/${safe}`;
}
