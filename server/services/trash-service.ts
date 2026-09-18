import path from "node:path";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { ensureDir, pathExists, removePath, renamePath, statOrNull, directorySize } from "@/server/storage/fs";
import { storageRootAbs } from "@/server/storage/config";
import { resolveScopedPath, childVirtual, virtualDirname } from "@/server/storage/path-resolver";
import { scopeForUser } from "@/server/storage/scope";
import { numberedFileName } from "@/server/storage/names";
import { bumpUsedBytes } from "@/server/storage/quota";
import { userHasPermission } from "@/lib/permissions";

function resolveOwned(user: SessionUser, virtualPath: string) {
  return resolveScopedPath(scopeForUser(user), virtualPath);
}

const TRASH_DAYS = 30;
const TRASH_DIR = ".trash";

export function trashRootAbs(): string {
  return path.join(storageRootAbs(), TRASH_DIR);
}

export function trashItemAbs(userId: string, id: string, name: string): string {
  return path.join(trashRootAbs(), userId, id, name);
}

function expiresAt(from = new Date()): Date {
  return new Date(from.getTime() + TRASH_DAYS * 24 * 60 * 60 * 1000);
}

async function uniqueRestoreName(user: SessionUser, parentVirtual: string, name: string): Promise<string> {
  let candidate = name;
  let i = 1;
  while (await pathExists(resolveOwned(user, childVirtual(parentVirtual, candidate)).absPath)) {
    candidate = numberedFileName(name, i);
    i += 1;
    if (i > 50) throw new AppError("ALREADY_EXISTS", "Wiederherstellen nicht möglich: Name existiert bereits.", 409);
  }
  return candidate;
}

export async function moveToTrash(user: SessionUser, virtualPath: string) {
  const resolved = resolveOwned(user, virtualPath);
  if (resolved.virtualPath === "/") throw new AppError("FORBIDDEN", "Das Wurzelverzeichnis kann nicht gelöscht werden.", 400);
  const stat = await statOrNull(resolved.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Datei oder Ordner nicht gefunden.", 404);
  if (!userHasPermission(user, stat.isDirectory() ? "folders.delete" : "files.delete")) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
  const size = stat.isDirectory() ? Number(await directorySize(resolved.absPath, resolved.absPath)) : Number(stat.size);
  const item = await prisma.trashItem.create({
    data: {
      userId: user.id,
      originalVirtualPath: resolved.virtualPath,
      name: resolved.name,
      isDir: stat.isDirectory(),
      size: BigInt(size),
      expiresAt: expiresAt(),
    },
  });
  const dest = trashItemAbs(user.id, item.id, resolved.name);
  await ensureDir(path.dirname(dest));
  try {
    await renamePath(resolved.absPath, dest);
  } catch (error) {
    await prisma.trashItem.delete({ where: { id: item.id } }).catch(() => undefined);
    throw error;
  }
  return item;
}

export async function listTrash(user: SessionUser) {
  await purgeExpiredTrash(user.id);
  const rows = await prisma.trashItem.findMany({
    where: { userId: user.id },
    orderBy: { deletedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    originalPath: row.originalVirtualPath,
    isDir: row.isDir,
    size: Number(row.size),
    deletedAt: row.deletedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function restoreTrashItem(user: SessionUser, id: string) {
  const row = await prisma.trashItem.findFirst({ where: { id, userId: user.id } });
  if (!row) throw new AppError("NOT_FOUND", "Eintrag nicht im Papierkorb.", 404);
  const source = trashItemAbs(user.id, row.id, row.name);
  if (!(await pathExists(source))) {
    await prisma.trashItem.delete({ where: { id: row.id } });
    throw new AppError("NOT_FOUND", "Die Datei im Papierkorb fehlt.", 404);
  }
  let parent = virtualDirname(row.originalVirtualPath);
  const parentResolved = resolveOwned(user, parent);
  if (!(await pathExists(parentResolved.absPath))) parent = "/";
  const name = await uniqueRestoreName(user, parent, row.name);
  const dest = resolveOwned(user, childVirtual(parent, name));
  await ensureDir(path.dirname(dest.absPath));
  await renamePath(source, dest.absPath);
  await prisma.trashItem.delete({ where: { id: row.id } });
  await removePath(path.dirname(source)).catch(() => undefined);
  return { path: dest.virtualPath, name };
}

export async function purgeTrashItem(user: SessionUser, id: string) {
  const row = await prisma.trashItem.findFirst({ where: { id, userId: user.id } });
  if (!row) throw new AppError("NOT_FOUND", "Eintrag nicht im Papierkorb.", 404);
  const source = trashItemAbs(user.id, row.id, row.name);
  await removePath(source).catch(() => undefined);
  await removePath(path.dirname(source)).catch(() => undefined);
  await prisma.trashItem.delete({ where: { id: row.id } });
  if (Number(row.size) > 0) await bumpUsedBytes(user.id, -Number(row.size));
}

export async function emptyTrash(user: SessionUser) {
  const rows = await prisma.trashItem.findMany({ where: { userId: user.id } });
  for (const row of rows) {
    await purgeTrashItem(user, row.id);
  }
  return { count: rows.length };
}

export async function purgeExpiredTrash(userId?: string) {
  const where = { expiresAt: { lte: new Date() }, ...(userId ? { userId } : {}) };
  const rows = await prisma.trashItem.findMany({ where });
  for (const row of rows) {
    const source = trashItemAbs(row.userId, row.id, row.name);
    await removePath(source).catch(() => undefined);
    await removePath(path.dirname(source)).catch(() => undefined);
    if (Number(row.size) > 0) await bumpUsedBytes(row.userId, -Number(row.size));
    await prisma.trashItem.delete({ where: { id: row.id } }).catch(() => undefined);
  }
}

export async function trashBytesForUser(userId: string): Promise<bigint> {
  const rows = await prisma.trashItem.findMany({ where: { userId }, select: { size: true } });
  return rows.reduce((sum, row) => sum + row.size, BigInt(0));
}
