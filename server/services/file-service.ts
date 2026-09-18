import fs from "node:fs";
import { createReadStream } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { PassThrough, type Readable } from "node:stream";
import { formatBytes } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { isEditable, kindOf } from "@/lib/file-kinds";
import { isAdministrator, userHasPermission, type Permission } from "@/lib/permissions";
import type { Breadcrumb, ExplorerEntry, SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import {
  copyPath,
  ensureDir,
  listDirectory,
  pathExists,
  readFileLimited,
  renamePath,
  statOrNull,
  writeFileAtomic,
  writeStreamToFile,
  directorySize,
} from "@/server/storage/fs";
import { mimeFromName } from "@/server/storage/mime";
import { fileIndexKey, fileIndexVisibleFilter, isTrashIndexPath, parseFileIndexKey } from "@/server/storage/file-index";
import { uniqueFileName } from "@/server/storage/names";
import { assertQuota, bumpUsedBytes, countsTowardQuota } from "@/server/storage/quota";
import { scopeForUser } from "@/server/storage/scope";
import {
  assertSafeFileName,
  assertScopeWritable,
  childVirtual,
  extraRootFor,
  isExtraRootVirtual,
  isInsideRoot,
  normalizeVirtualPath,
  resolveScopedPath,
  virtualBasename,
  virtualDirname,
  type ExtraRoot,
  type ResolvedPath,
} from "@/server/storage/path-resolver";

const EDITOR_MAX_BYTES = 2 * 1024 * 1024;

function requirePerm(user: SessionUser, permission: Permission): void {
  if (!userHasPermission(user, permission)) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
}

function mountPayload(extra: ExtraRoot | null, showHost: boolean) {
  if (!extra) return undefined;
  return {
    label: extra.kind === "home" ? "Home" : "Ordner",
    name: extra.label,
    kind: extra.kind,
    hostPath: showHost ? extra.absRoot : undefined,
  };
}

function listingParentPath(virtualPath: string, extra: ExtraRoot | null): string | null {
  if (virtualPath === "/") return null;
  if (extra && virtualPath === extra.virtualRoot) return "/";
  return virtualDirname(virtualPath);
}

function toEntry(resolved: ResolvedPath, stat: fs.Stats, showHost = false): ExplorerEntry {
  const extra = extraRootFor(resolved.scope, resolved.virtualPath);
  const root = isExtraRootVirtual(resolved.scope, resolved.virtualPath);
  const mount = root ? mountPayload(extra, showHost) : undefined;
  return {
    name: resolved.name,
    path: resolved.virtualPath,
    isDir: stat.isDirectory(),
    size: stat.isDirectory() ? 0 : Number(stat.size),
    modifiedAt: stat.mtime.toISOString(),
    mimeType: stat.isDirectory() ? null : mimeFromName(resolved.name),
    kind: kindOf(resolved.name, stat.isDirectory()),
    editable: isEditable(resolved.name, stat.isDirectory()),
    displayName: root && extra ? extra.label : undefined,
    mount,
  };
}

export function breadcrumbs(virtualPath: string, rootLabel: string, extraRoots?: ExtraRoot[]): Breadcrumb[] {
  const normalized = normalizeVirtualPath(virtualPath);
  const crumbs: Breadcrumb[] = [{ name: rootLabel, path: "/" }];
  if (normalized === "/") return crumbs;
  const extra = extraRoots?.length
    ? extraRoots
        .filter((root) => normalized === root.virtualRoot || normalized.startsWith(`${root.virtualRoot}/`))
        .sort((a, b) => b.virtualRoot.length - a.virtualRoot.length)[0]
    : undefined;
  if (extra) {
    crumbs.push({ name: extra.label, path: extra.virtualRoot });
    if (normalized === extra.virtualRoot) return crumbs;
    const rest = normalized.slice(extra.virtualRoot.length).split("/").filter(Boolean);
    let current = extra.virtualRoot;
    for (const part of rest) {
      current += `/${part}`;
      crumbs.push({ name: part, path: current });
    }
    return crumbs;
  }
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

async function upsertIndex(resolved: ResolvedPath, stat: fs.Stats, ownerId: string | null): Promise<void> {
  try {
    await prisma.fileIndex.upsert({
      where: { virtualPath: fileIndexKey(resolved.scope.kind, resolved.virtualPath) },
      create: {
        virtualPath: fileIndexKey(resolved.scope.kind, resolved.virtualPath),
        name: resolved.name,
        isDir: stat.isDirectory(),
        size: BigInt(stat.isDirectory() ? 0 : stat.size),
        mimeType: stat.isDirectory() ? null : mimeFromName(resolved.name),
        ownerId,
      },
      update: {
        name: resolved.name,
        isDir: stat.isDirectory(),
        size: BigInt(stat.isDirectory() ? 0 : stat.size),
        mimeType: stat.isDirectory() ? null : mimeFromName(resolved.name),
        ownerId,
      },
    });
  } catch (error) {
    logger.warn({ err: error }, "file index upsert failed");
  }
}

async function removeIndex(scopeKind: string, virtualPath: string): Promise<void> {
  const prefix = fileIndexKey(scopeKind, virtualPath);
  await prisma.fileIndex.deleteMany({
    where: {
      OR: [{ virtualPath: prefix }, { virtualPath: { startsWith: `${prefix}/` } }],
    },
  });
}

export function resolveUserPath(user: SessionUser, virtualPath: string): ResolvedPath {
  return resolveScopedPath(scopeForUser(user), virtualPath);
}

export async function listFiles(user: SessionUser, virtualPath: string) {
  requirePerm(user, "files.read");
  const resolved = resolveUserPath(user, virtualPath);
  const showHost = isAdministrator(user);
  const extra = extraRootFor(resolved.scope, resolved.virtualPath);
  const items: ExplorerEntry[] = [];

  if (resolved.virtualPath === "/") {
    for (const root of resolved.scope.extraRoots ?? []) {
      try {
        const child = resolveUserPath(user, root.virtualRoot);
        const childStat = await statOrNull(child.absPath);
        if (!childStat) continue;
        items.push(toEntry(child, childStat, showHost));
        void upsertIndex(child, childStat, user.id);
      } catch (error) {
        logger.warn({ err: error, root: root.virtualRoot }, "extra root skipped");
      }
    }
  } else {
    const stat = await statOrNull(resolved.absPath);
    if (!stat) throw new AppError("NOT_FOUND", "Ordner nicht gefunden.", 404);
    if (!stat.isDirectory()) throw new AppError("NOT_A_FOLDER", "Der Pfad ist kein Ordner.", 400);
    const entries = await listDirectory(resolved.absPath);
    for (const entry of entries) {
      if (entry.name === ".trash") continue;
      const child = resolveUserPath(user, childVirtual(resolved.virtualPath, entry.name));
      const childStat = await statOrNull(child.absPath);
      if (!childStat) continue;
      items.push(toEntry(child, childStat, showHost));
      void upsertIndex(child, childStat, user.id);
    }
  }

  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "de", { sensitivity: "base" });
  });
  const writable = resolved.virtualPath !== "/" && Boolean(extra?.writable);
  return {
    path: resolved.virtualPath,
    parentPath: listingParentPath(resolved.virtualPath, extra),
    breadcrumbs: breadcrumbs(resolved.virtualPath, resolved.scope.rootLabel, resolved.scope.extraRoots),
    scope: resolved.scope.kind,
    rootLabel: resolved.scope.rootLabel,
    catalog: resolved.virtualPath === "/",
    writable,
    mount: extra && resolved.virtualPath !== "/" ? mountPayload(extra, showHost) : undefined,
    items,
  };
}

export async function createFolder(user: SessionUser, parent: string, name: string) {
  requirePerm(user, "folders.create");
  if (name === ".trash") {
    throw new AppError("FORBIDDEN", "Dieser Ordnername ist reserviert.", 400);
  }
  const dest = resolveUserPath(user, childVirtual(parent, name));
  assertScopeWritable(dest.scope, dest.virtualPath);
  if (await pathExists(dest.absPath)) {
    throw new AppError("ALREADY_EXISTS", "Ein Eintrag mit diesem Namen existiert bereits.", 409);
  }
  await ensureDir(dest.absPath);
  const stat = await fsPromises.stat(dest.absPath);
  await upsertIndex(dest, stat, user.id);
  return toEntry(dest, stat);
}

export async function renameEntry(user: SessionUser, virtualPath: string, newName: string) {
  const source = resolveUserPath(user, virtualPath);
  if (source.virtualPath === "/") throw new AppError("FORBIDDEN", "Das Wurzelverzeichnis kann nicht umbenannt werden.", 400);
  if (isExtraRootVirtual(source.scope, source.virtualPath)) {
    throw new AppError("FORBIDDEN", "Zugewiesene Ordner können nicht umbenannt werden.", 400);
  }
  assertScopeWritable(source.scope, source.virtualPath);
  const stat = await statOrNull(source.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Datei oder Ordner nicht gefunden.", 404);
  requirePerm(user, stat.isDirectory() ? "folders.rename" : "files.rename");
  const dest = resolveUserPath(user, childVirtual(source.parentVirtual, newName));
  if (await pathExists(dest.absPath)) {
    throw new AppError("ALREADY_EXISTS", "Ein Eintrag mit diesem Namen existiert bereits.", 409);
  }
  await renamePath(source.absPath, dest.absPath);
  await removeIndex(source.scope.kind, source.virtualPath);
  const nextStat = await fsPromises.stat(dest.absPath);
  await upsertIndex(dest, nextStat, user.id);
  return toEntry(dest, nextStat);
}

async function prepareDestination(user: SessionUser, from: string, toDir: string, conflictName?: string) {
  const source = resolveUserPath(user, from);
  if (source.virtualPath === "/") throw new AppError("FORBIDDEN", "Das Wurzelverzeichnis kann nicht verschoben werden.", 400);
  if (isExtraRootVirtual(source.scope, source.virtualPath)) {
    throw new AppError("FORBIDDEN", "Zugewiesene Ordner können nicht verschoben werden.", 400);
  }
  assertScopeWritable(source.scope, source.virtualPath);
  const destParent = resolveUserPath(user, toDir);
  const dest = resolveUserPath(user, childVirtual(destParent.virtualPath, conflictName || source.name));
  assertScopeWritable(dest.scope, dest.virtualPath);
  if (dest.virtualPath === source.virtualPath || dest.virtualPath.startsWith(`${source.virtualPath}/`)) {
    throw new AppError("INVALID_PATH", "Ein Ordner kann nicht in sich selbst verschoben werden.", 400);
  }
  return { source, dest };
}

export async function moveEntry(user: SessionUser, from: string, toDir: string) {
  const { source, dest } = await prepareDestination(user, from, toDir);
  const stat = await statOrNull(source.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Datei oder Ordner nicht gefunden.", 404);
  requirePerm(user, stat.isDirectory() ? "folders.move" : "files.move");
  if (await pathExists(dest.absPath)) {
    throw new AppError("ALREADY_EXISTS", "Am Ziel existiert bereits ein Eintrag mit diesem Namen.", 409);
  }
  await renamePath(source.absPath, dest.absPath);
  await removeIndex(source.scope.kind, source.virtualPath);
  const nextStat = await fsPromises.stat(dest.absPath);
  await upsertIndex(dest, nextStat, user.id);
  return toEntry(dest, nextStat);
}

export async function copyEntry(user: SessionUser, from: string, toDir: string) {
  requirePerm(user, "files.copy");
  const { source, dest } = await prepareDestination(user, from, toDir);
  const stat = await statOrNull(source.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Datei oder Ordner nicht gefunden.", 404);
  if (await pathExists(dest.absPath)) {
    throw new AppError("ALREADY_EXISTS", "Am Ziel existiert bereits ein Eintrag mit diesem Namen.", 409);
  }
  const billed = countsTowardQuota(dest);
  const extra = stat.isDirectory()
    ? Number(await directorySize(source.absPath, source.absPath))
    : Number(stat.size);
  if (billed) await assertQuota(user, extra);
  await copyPath(source.absPath, dest.absPath);
  if (billed) await bumpUsedBytes(user.id, extra);
  const nextStat = await fsPromises.stat(dest.absPath);
  await upsertIndex(dest, nextStat, user.id);
  return toEntry(dest, nextStat);
}

export async function deleteEntry(user: SessionUser, virtualPath: string) {
  const resolved = resolveUserPath(user, virtualPath);
  if (isExtraRootVirtual(resolved.scope, resolved.virtualPath)) {
    const extra = extraRootFor(resolved.scope, resolved.virtualPath);
    throw new AppError(
      "FORBIDDEN",
      extra?.kind === "home" ? "Home kann nicht gelöscht werden." : "Zugewiesene Ordner können nicht gelöscht werden.",
      400,
    );
  }
  assertScopeWritable(resolved.scope, resolved.virtualPath);
  const { moveToTrash } = await import("@/server/services/trash-service");
  await moveToTrash(user, virtualPath);
  await removeIndex(resolved.scope.kind, resolved.virtualPath);
}

export async function uploadFile(
  user: SessionUser,
  parent: string,
  fileName: string,
  stream: Readable,
  sizeHint?: number,
  relativePath?: string,
  overwrite = false,
) {
  requirePerm(user, "files.upload");
  const env = getEnv();
  let targetParent = normalizeVirtualPath(parent);
  if (relativePath) {
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();
    for (const part of parts) {
      targetParent = childVirtual(targetParent, part);
      const folder = resolveUserPath(user, targetParent);
      assertScopeWritable(folder.scope, folder.virtualPath);
      await ensureDir(folder.absPath);
    }
  }
  let dest = resolveUserPath(user, childVirtual(targetParent, fileName));
  assertScopeWritable(dest.scope, dest.virtualPath);
  let existing = await statOrNull(dest.absPath);
  if (existing?.isDirectory()) {
    throw new AppError("ALREADY_EXISTS", "Ein Ordner mit diesem Namen existiert bereits.", 409);
  }
  if (existing && !overwrite) {
    const unique = await uniqueFileName(path.dirname(dest.absPath), dest.name);
    dest = resolveUserPath(user, childVirtual(targetParent, unique));
    existing = null;
  }
  const previous = existing && !existing.isDirectory() ? Number(existing.size) : 0;
  if (sizeHint && sizeHint > env.maxUploadBytes) {
    throw new AppError("FILE_TOO_LARGE", "Die Datei überschreitet das Upload-Limit.", 413, {
      maxBytes: env.maxUploadBytes,
      fileBytes: sizeHint,
    });
  }
  const billed = countsTowardQuota(dest);
  const hintedDelta = Math.max(0, (sizeHint ?? 0) - previous);
  if (billed && hintedDelta) await assertQuota(user, hintedDelta);
  const tmp = `${dest.absPath}.cloudora-up-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const written = await writeStreamToFile(tmp, stream, env.maxUploadBytes, "w");
  const delta = written - previous;
  try {
    if (billed) await assertQuota(user, Math.max(0, delta));
    await fsPromises.rename(tmp, dest.absPath);
  } catch (error) {
    await fsPromises.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  if (billed) await bumpUsedBytes(user.id, delta);
  const stat = await fsPromises.stat(dest.absPath);
  await upsertIndex(dest, stat, user.id);
  return toEntry(dest, stat);
}

export async function downloadTarget(user: SessionUser, virtualPath: string) {
  requirePerm(user, "files.download");
  const resolved = resolveUserPath(user, virtualPath);
  const stat = await statOrNull(resolved.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Datei oder Ordner nicht gefunden.", 404);
  return { resolved, stat };
}

export function openFileStream(absPath: string): fs.ReadStream {
  return createReadStream(absPath);
}

export async function assertZipBudget(absPath: string): Promise<{ files: number; bytes: number }> {
  const env = getEnv();
  let files = 0;
  let bytes = BigInt(0);

  async function walk(current: string): Promise<void> {
    if (!isInsideRoot(absPath, current)) return;
    let entries;
    try {
      entries = await fsPromises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".trash") continue;
      const next = path.join(current, entry.name);
      if (!isInsideRoot(absPath, next)) continue;
      try {
        if (entry.isDirectory()) {
          await walk(next);
          continue;
        }
        if (!entry.isFile()) continue;
        const st = await fsPromises.stat(next);
        files += 1;
        bytes += BigInt(st.size);
        if (files > env.maxZipFiles) {
          throw new AppError(
            "ZIP_TOO_MANY_FILES",
            `Dieser Ordner enthält zu viele Dateien für den ZIP-Download (max. ${env.maxZipFiles}).`,
            413,
            { maxFiles: env.maxZipFiles },
          );
        }
        if (bytes > BigInt(env.maxZipBytes)) {
          throw new AppError(
            "ZIP_TOO_LARGE",
            `Dieser Ordner ist zu groß für den ZIP-Download (max. ${formatBytes(env.maxZipBytes)}).`,
            413,
            { maxBytes: env.maxZipBytes },
          );
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
    }
  }

  await walk(absPath);
  return { files, bytes: Number(bytes) };
}

export function zipDirectory(absPath: string, folderName: string) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const prefix = folderName.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "") || "folder";
  archive.directory(absPath, prefix, (entry) => {
    const name = entry.name.replace(/\\/g, "/");
    if (name === ".trash" || name.startsWith(".trash/")) return false;
    return entry;
  });
  void archive.finalize();
  return archive;
}

export async function readEditableContent(user: SessionUser, virtualPath: string) {
  requirePerm(user, "files.read");
  const resolved = resolveUserPath(user, virtualPath);
  const stat = await statOrNull(resolved.absPath);
  if (!stat || stat.isDirectory()) throw new AppError("NOT_FOUND", "Datei nicht gefunden.", 404);
  if (!isEditable(resolved.name, false)) {
    throw new AppError("NOT_EDITABLE", "Dieser Dateityp kann in Formator nicht bearbeitet werden.", 415);
  }
  const buf = await readFileLimited(resolved.absPath, EDITOR_MAX_BYTES);
  return {
    path: resolved.virtualPath,
    name: resolved.name,
    content: buf.toString("utf8"),
    size: Number(stat.size),
    language: path.extname(resolved.name).slice(1),
  };
}

export async function writeEditableContent(user: SessionUser, virtualPath: string, content: string) {
  requirePerm(user, "files.edit");
  const resolved = resolveUserPath(user, virtualPath);
  assertScopeWritable(resolved.scope, resolved.virtualPath);
  const existing = await statOrNull(resolved.absPath);
  if (existing?.isDirectory()) throw new AppError("NOT_A_FILE", "Ordner können nicht bearbeitet werden.", 400);
  const previous = existing ? Number(existing.size) : 0;
  const nextSize = Buffer.byteLength(content, "utf8");
  const billed = countsTowardQuota(resolved);
  const delta = nextSize - previous;
  if (billed) await assertQuota(user, Math.max(0, delta));
  const written = await writeFileAtomic(resolved.absPath, content);
  if (billed) await bumpUsedBytes(user.id, written - previous);
  const stat = await fsPromises.stat(resolved.absPath);
  await upsertIndex(resolved, stat, user.id);
  return toEntry(resolved, stat);
}

export async function saveAs(user: SessionUser, parent: string, name: string, content: string) {
  requirePerm(user, "files.edit");
  const dest = resolveUserPath(user, childVirtual(parent, name));
  if (await pathExists(dest.absPath)) {
    throw new AppError("ALREADY_EXISTS", "Eine Datei mit diesem Namen existiert bereits.", 409);
  }
  return writeEditableContent(user, dest.virtualPath, content);
}

export async function searchFiles(user: SessionUser, query: string, limit = 50) {
  requirePerm(user, "files.read");
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const scope = scopeForUser(user);
  const showHost = isAdministrator(user);
  const extras = scope.extraRoots ?? [];
  const results: ExplorerEntry[] = [];
  const seen = new Set<string>();

  function push(entry: ExplorerEntry) {
    if (seen.has(entry.path) || results.length >= limit) return;
    seen.add(entry.path);
    results.push(entry);
  }

  for (const extra of extras) {
    if (!extra.label.toLowerCase().includes(q) && !extra.virtualRoot.toLowerCase().includes(q)) continue;
    try {
      const resolved = resolveScopedPath(scope, extra.virtualRoot);
      const stat = await statOrNull(resolved.absPath);
      if (stat) push(toEntry(resolved, stat, showHost));
    } catch {
      /* skip unreachable root */
    }
  }

  const visible = fileIndexVisibleFilter(scope.kind, extras.map((root) => root.virtualRoot));
  if (!visible.length) return results;

  const rows = await prisma.fileIndex.findMany({
    where: {
      AND: [{ name: { contains: q, mode: "insensitive" } }, { OR: visible }],
    },
    take: Math.min(200, limit * 4),
    orderBy: { name: "asc" },
  });

  for (const row of rows) {
    if (results.length >= limit) break;
    const parsed = parseFileIndexKey(row.virtualPath);
    if (!parsed || parsed.scopeKind !== scope.kind) continue;
    if (isTrashIndexPath(parsed.virtualPath)) {
      await prisma.fileIndex.delete({ where: { id: row.id } }).catch(() => undefined);
      continue;
    }
    try {
      const resolved = resolveScopedPath(scope, parsed.virtualPath);
      const stat = await statOrNull(resolved.absPath);
      if (!stat) {
        await prisma.fileIndex.delete({ where: { id: row.id } }).catch(() => undefined);
        continue;
      }
      push(toEntry(resolved, stat, showHost));
    } catch {
      await prisma.fileIndex.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  }

  return results;
}

export { childVirtual, assertSafeFileName, virtualBasename, virtualDirname, PassThrough };
