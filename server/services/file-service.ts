import fs from "node:fs";
import { createReadStream } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { PassThrough, type Readable } from "node:stream";
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
} from "@/server/storage/fs";
import { mimeFromName } from "@/server/storage/mime";
import {
  assertSafeFileName,
  childVirtual,
  normalizeVirtualPath,
  resolveScopedPath,
  virtualBasename,
  virtualDirname,
  type ResolvedPath,
} from "@/server/storage/path-resolver";
import { assertQuota, bumpUsedBytes } from "@/server/storage/quota";
import { scopeForUser } from "@/server/storage/scope";
import {
  extraVolumeForAbsPath,
  extraVolumeForChildName,
  getCachedExtraVolumes,
  hydrateExtraVolumes,
  isExtraVolumeRoot,
} from "@/server/storage/extra-volumes";
import { storageRootAbs } from "@/server/storage/config";

const EDITOR_MAX_BYTES = 2 * 1024 * 1024;

function requirePerm(user: SessionUser, permission: Permission): void {
  if (!userHasPermission(user, permission)) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
}

function mountPayload(vol: { name: string; hostPath: string } | null, showHost: boolean) {
  if (!vol) return undefined;
  return {
    label: "Host-Datenträger",
    hostPath: showHost ? vol.hostPath : undefined,
  };
}

function toEntry(
  resolved: ResolvedPath,
  stat: fs.Stats,
  vol: { name: string; hostPath: string } | null = null,
  showHost = false,
): ExplorerEntry {
  const mount = mountPayload(vol, showHost);
  return {
    name: resolved.name,
    path: resolved.virtualPath,
    isDir: stat.isDirectory(),
    size: stat.isDirectory() ? 0 : Number(stat.size),
    modifiedAt: stat.mtime.toISOString(),
    mimeType: stat.isDirectory() ? null : mimeFromName(resolved.name),
    kind: kindOf(resolved.name, stat.isDirectory()),
    editable: isEditable(resolved.name, stat.isDirectory()),
    displayName: vol && stat.isDirectory() ? vol.name : undefined,
    mount,
  };
}

export function breadcrumbs(
  virtualPath: string,
  rootLabel: string,
  volumeNames: Record<string, string> = {},
): Breadcrumb[] {
  const normalized = normalizeVirtualPath(virtualPath);
  const crumbs: Breadcrumb[] = [{ name: rootLabel, path: "/" }];
  if (normalized === "/") return crumbs;
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const label =
      part === "volumes" ? "Volumes" : volumeNames[part] ? volumeNames[part] : part;
    crumbs.push({ name: label, path: current });
  }
  return crumbs;
}

async function upsertIndex(resolved: ResolvedPath, stat: fs.Stats, ownerId: string | null): Promise<void> {
  try {
    await prisma.fileIndex.upsert({
      where: { virtualPath: `${resolved.scope.kind}:${resolved.virtualPath}` },
      create: {
        virtualPath: `${resolved.scope.kind}:${resolved.virtualPath}`,
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
  const prefix = `${scopeKind}:${virtualPath}`;
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
  await hydrateExtraVolumes();
  const resolved = resolveUserPath(user, virtualPath);
  const stat = await statOrNull(resolved.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Ordner nicht gefunden.", 404);
  if (!stat.isDirectory()) throw new AppError("NOT_A_FOLDER", "Der Pfad ist kein Ordner.", 400);
  const volumes = getCachedExtraVolumes();
  const storageRoot = storageRootAbs();
  const showHost = isAdministrator(user);
  const volumeNames = Object.fromEntries(volumes.map((vol) => [vol.id, vol.name]));
  const hereVol = extraVolumeForAbsPath(resolved.absPath, storageRoot, volumes);
  const entries = await listDirectory(resolved.absPath);
  const items: ExplorerEntry[] = [];
  for (const entry of entries) {
    if (entry.name === ".trash") continue;
    const child = resolveUserPath(user, childVirtual(resolved.virtualPath, entry.name));
    const childStat = await statOrNull(child.absPath);
    if (!childStat) continue;
    const childVol =
      extraVolumeForChildName(resolved.absPath, entry.name, storageRoot, volumes) ??
      (isExtraVolumeRoot(child.absPath, storageRoot, volumes)
        ? extraVolumeForAbsPath(child.absPath, storageRoot, volumes)
        : null);
    items.push(toEntry(child, childStat, childVol, showHost));
    void upsertIndex(child, childStat, user.id);
  }
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "de", { sensitivity: "base" });
  });
  const rootLabel =
    resolved.virtualPath === "/" && hereVol
      ? hereVol.name
      : resolved.scope.rootLabel;
  return {
    path: resolved.virtualPath,
    breadcrumbs: breadcrumbs(resolved.virtualPath, rootLabel, volumeNames),
    scope: resolved.scope.kind,
    rootLabel,
    mount: mountPayload(hereVol, showHost),
    items,
  };
}

export async function createFolder(user: SessionUser, parent: string, name: string) {
  requirePerm(user, "folders.create");
  if (name === ".trash") {
    throw new AppError("FORBIDDEN", "Dieser Ordnername ist reserviert.", 400);
  }
  const dest = resolveUserPath(user, childVirtual(parent, name));
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
  if (isExtraVolumeRoot(source.absPath, storageRootAbs(), getCachedExtraVolumes())) {
    throw new AppError("FORBIDDEN", "Host-Datenträger können nicht umbenannt werden.", 400);
  }
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
  if (isExtraVolumeRoot(source.absPath, storageRootAbs(), getCachedExtraVolumes())) {
    throw new AppError("FORBIDDEN", "Host-Datenträger können nicht verschoben werden.", 400);
  }
  const destParent = resolveUserPath(user, toDir);
  const dest = resolveUserPath(user, childVirtual(destParent.virtualPath, conflictName || source.name));
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
  const extra = stat.isDirectory() ? Number(stat.size) : Number(stat.size);
  if (!stat.isDirectory()) await assertQuota(user, extra);
  await copyPath(source.absPath, dest.absPath);
  if (!stat.isDirectory()) await bumpUsedBytes(user.id, extra);
  const nextStat = await fsPromises.stat(dest.absPath);
  await upsertIndex(dest, nextStat, user.id);
  return toEntry(dest, nextStat);
}

export async function deleteEntry(user: SessionUser, virtualPath: string) {
  const resolved = resolveUserPath(user, virtualPath);
  if (isExtraVolumeRoot(resolved.absPath, storageRootAbs(), getCachedExtraVolumes())) {
    throw new AppError("FORBIDDEN", "Host-Datenträger können nicht gelöscht werden.", 400);
  }
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
      await ensureDir(folder.absPath);
    }
  }
  const dest = resolveUserPath(user, childVirtual(targetParent, fileName));
  if (sizeHint && sizeHint > env.maxUploadBytes) {
    throw new AppError("FILE_TOO_LARGE", "Die Datei überschreitet das Upload-Limit.", 413, {
      maxBytes: env.maxUploadBytes,
      fileBytes: sizeHint,
    });
  }
  if (sizeHint) await assertQuota(user, sizeHint);
  const written = await writeStreamToFile(dest.absPath, stream, env.maxUploadBytes);
  try {
    await assertQuota(user, written);
  } catch (error) {
    await fsPromises.rm(dest.absPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await bumpUsedBytes(user.id, written);
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
  const existing = await statOrNull(resolved.absPath);
  if (existing?.isDirectory()) throw new AppError("NOT_A_FILE", "Ordner können nicht bearbeitet werden.", 400);
  const previous = existing ? Number(existing.size) : 0;
  const nextSize = Buffer.byteLength(content, "utf8");
  await assertQuota(user, Math.max(0, nextSize - previous));
  const written = await writeFileAtomic(resolved.absPath, content);
  await bumpUsedBytes(user.id, written - previous);
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
  const results: ExplorerEntry[] = [];
  const maxScan = 8000;
  let scanned = 0;

  async function walk(virtual: string): Promise<void> {
    if (results.length >= limit || scanned >= maxScan) return;
    const resolved = resolveScopedPath(scope, virtual);
    let entries;
    try {
      entries = await listDirectory(resolved.absPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit || scanned >= maxScan) return;
      if (entry.name === ".trash") continue;
      scanned += 1;
      const childVirtualPath = childVirtual(virtual, entry.name);
      const child = resolveScopedPath(scope, childVirtualPath);
      const stat = await statOrNull(child.absPath);
      if (!stat) continue;
      if (entry.name.toLowerCase().includes(q)) {
        results.push(toEntry(child, stat));
      }
      if (stat.isDirectory()) await walk(child.virtualPath);
    }
  }

  await walk("/");
  return results;
}

export { childVirtual, assertSafeFileName, virtualBasename, virtualDirname, PassThrough };
