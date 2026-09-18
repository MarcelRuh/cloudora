import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { userHasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { hashToken, randomToken } from "@/server/crypto";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { publicOrigin } from "@/server/http";
import { resolveUserPath, zipDirectory, assertZipBudget } from "@/server/services/file-service";
import { mimeFromName } from "@/server/storage/mime";
import { statOrNull } from "@/server/storage/fs";
import { childVirtual } from "@/server/storage/path-resolver";
import { toSessionUser } from "@/server/auth/session";
import { hydrateStoragePaths } from "@/server/storage/config";

export async function createShare(
  user: SessionUser,
  input: {
    path: string;
    permission?: "READ" | "DOWNLOAD" | "EDIT";
    password?: string;
    expiresInHours?: number | null;
  },
) {
  if (!userHasPermission(user, "shares.create")) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
  const resolved = resolveUserPath(user, input.path);
  const stat = await statOrNull(resolved.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Datei oder Ordner nicht gefunden.", 404);
  const token = randomToken(32);
  const hours = input.expiresInHours;
  const row = await prisma.share.create({
    data: {
      tokenHash: hashToken(token),
      createdById: user.id,
      virtualPath: resolved.virtualPath,
      name: resolved.name,
      permission: input.permission ?? "DOWNLOAD",
      passwordHash: input.password ? await hashPassword(input.password) : null,
      expiresAt: hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null,
    },
  });
  return {
    id: row.id,
    url: `${publicOrigin()}/s/${token}`,
    token,
    name: row.name,
    permission: row.permission,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    hasPassword: Boolean(row.passwordHash),
  };
}

export async function listShares(user: SessionUser, all: boolean) {
  const where = all && userHasPermission(user, "shares.manage") ? {} : { createdById: user.id };
  const rows = await prisma.share.findMany({
    where,
    include: { createdBy: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.virtualPath,
    permission: row.permission,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    hasPassword: Boolean(row.passwordHash),
    revoked: Boolean(row.revokedAt),
    downloadCount: row.downloadCount,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    valid: isShareValid(row),
  }));
}

function isShareValid(row: { revokedAt: Date | null; expiresAt: Date | null }): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export async function revokeShare(user: SessionUser, id: string) {
  const row = await prisma.share.findUnique({ where: { id } });
  if (!row) throw new AppError("NOT_FOUND", "Link nicht gefunden.", 404);
  if (row.createdById !== user.id && !userHasPermission(user, "shares.manage")) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
  if (row.revokedAt) return;
  await prisma.share.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function deleteShare(user: SessionUser, id: string) {
  const row = await prisma.share.findUnique({ where: { id } });
  if (!row) throw new AppError("NOT_FOUND", "Link nicht gefunden.", 404);
  if (!userHasPermission(user, "shares.manage") && row.createdById !== user.id) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
  await prisma.share.delete({ where: { id } });
}

export async function inspectPublicShare(token: string) {
  await hydrateStoragePaths();
  const row = await prisma.share.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { createdBy: { include: { role: true } } },
  });
  if (!row || !isShareValid(row)) throw new AppError("INVALID_TOKEN", "Dieser Link ist ungültig oder abgelaufen.", 404);
  const owner = toSessionUser(row.createdBy);
  const resolved = resolveUserPath(owner, row.virtualPath);
  const stat = await statOrNull(resolved.absPath);
  return {
    name: row.name,
    permission: row.permission,
    hasPassword: Boolean(row.passwordHash),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    isDir: Boolean(stat?.isDirectory()),
    canDownload: row.permission === "DOWNLOAD" || row.permission === "EDIT",
    canEdit: row.permission === "EDIT",
    canPreview: true,
  };
}

async function loadShare(token: string, password: string | undefined, unlocked = false) {
  await hydrateStoragePaths();
  const row = await prisma.share.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { createdBy: { include: { role: true } } },
  });
  if (!row || !isShareValid(row)) throw new AppError("INVALID_TOKEN", "Dieser Link ist ungültig oder abgelaufen.", 404);
  if (row.passwordHash && !unlocked) {
    if (!password) throw new AppError("PASSWORD_REQUIRED", "Dieser Link ist passwortgeschützt.", 401);
    const ok = await verifyPassword(password, row.passwordHash);
    if (!ok) throw new AppError("INVALID_PASSWORD", "Das Passwort ist falsch.", 401);
  }
  const owner = toSessionUser(row.createdBy);
  const resolved = resolveUserPath(owner, row.virtualPath);
  const stat = await statOrNull(resolved.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Die Datei ist nicht mehr verfügbar.", 404);
  return { row, owner, resolved, stat };
}

function childOfShare(owner: ReturnType<typeof toSessionUser>, shareVirtual: string, relative: string) {
  const base = resolveUserPath(owner, shareVirtual);
  const rel = (relative || "/").replace(/\\/g, "/");
  if (rel === "/" || rel === "" || rel === ".") return base;
  const parts = rel.split("/").filter(Boolean);
  let virtual = base.virtualPath;
  for (const part of parts) {
    virtual = childVirtual(virtual, part);
  }
  const target = resolveUserPath(owner, virtual);
  if (target.virtualPath !== base.virtualPath && !target.virtualPath.startsWith(`${base.virtualPath}/`)) {
    throw new AppError("PATH_TRAVERSAL", "Pfad liegt außerhalb dieses Links.", 403);
  }
  return target;
}

export async function consumePublicShare(
  token: string,
  password: string | undefined,
  relative = "/",
  unlocked = false,
  count = true,
) {
  const { row, owner, stat } = await loadShare(token, password, unlocked);
  if (row.permission === "READ") {
    throw new AppError("FORBIDDEN", "Download ist für diesen Link nicht erlaubt.", 403);
  }
  const target = stat.isDirectory() ? childOfShare(owner, row.virtualPath, relative) : resolveUserPath(owner, row.virtualPath);
  const targetStat = await statOrNull(target.absPath);
  if (!targetStat) throw new AppError("NOT_FOUND", "Die Datei ist nicht mehr verfügbar.", 404);
  if (count) {
    await prisma.share.update({ where: { id: row.id }, data: { downloadCount: { increment: 1 } } });
  }
  if (targetStat.isDirectory()) {
    await assertZipBudget(target.absPath);
    const name = `${target.name || row.name}.zip`;
    return {
      name,
      size: null as number | null,
      mime: "application/zip",
      absPath: target.absPath,
      stream: zipDirectory(target.absPath, target.name || row.name),
    };
  }
  return {
    name: target.name,
    size: Number(targetStat.size),
    mime: mimeFromName(target.name),
    absPath: target.absPath,
    stream: fs.createReadStream(target.absPath),
  };
}

export async function previewPublicShare(token: string, password: string | undefined, relative = "/", unlocked = false) {
  const { row, owner, stat } = await loadShare(token, password, unlocked);
  const target = stat.isDirectory() ? childOfShare(owner, row.virtualPath, relative) : resolveUserPath(owner, row.virtualPath);
  const targetStat = await statOrNull(target.absPath);
  if (!targetStat || targetStat.isDirectory()) throw new AppError("NOT_FOUND", "Die Datei ist nicht mehr verfügbar.", 404);
  return {
    name: target.name,
    size: Number(targetStat.size),
    mime: mimeFromName(target.name),
    absPath: target.absPath,
    stat: targetStat,
  };
}

export async function listPublicShare(token: string, password: string | undefined, relative = "/", unlocked = false) {
  const { row, owner, stat } = await loadShare(token, password, unlocked);
  if (!stat.isDirectory()) {
    return {
      path: "/",
      items: [{ name: row.name, isDir: false, size: Number(stat.size) }],
    };
  }
  const dir = childOfShare(owner, row.virtualPath, relative);
  const dirStat = await statOrNull(dir.absPath);
  if (!dirStat?.isDirectory()) throw new AppError("NOT_A_FOLDER", "Kein Ordner.", 400);
  const entries = await fs.promises.readdir(dir.absPath, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (entry.name === ".trash" || entry.name.startsWith(".")) continue;
    const child = childOfShare(owner, dir.virtualPath, entry.name);
    const childStat = await statOrNull(child.absPath);
    if (!childStat) continue;
    items.push({ name: entry.name, isDir: childStat.isDirectory(), size: childStat.isDirectory() ? 0 : Number(childStat.size) });
  }
  return { path: relative || "/", items };
}

export async function uploadPublicShare(
  token: string,
  password: string | undefined,
  fileName: string,
  stream: import("node:stream").Readable,
  relativeDir = "/",
  unlocked = false,
) {
  const { row, owner, stat } = await loadShare(token, password, unlocked);
  if (row.permission !== "EDIT") throw new AppError("FORBIDDEN", "Dieser Link erlaubt kein Hochladen.", 403);
  const { assertSafeFileName, childVirtual: joinChild } = await import("@/server/storage/path-resolver");
  const { writeStreamToFile } = await import("@/server/storage/fs");
  const { uniqueFileName } = await import("@/server/storage/names");
  const { getEnv } = await import("@/server/env");
  const safe = assertSafeFileName(fileName);
  let dest = stat.isDirectory()
    ? resolveUserPath(owner, joinChild(childOfShare(owner, row.virtualPath, relativeDir).virtualPath, safe))
    : resolveUserPath(owner, row.virtualPath);
  const fileShare = !stat.isDirectory();
  let existing = await statOrNull(dest.absPath);
  if (existing?.isDirectory()) {
    throw new AppError("ALREADY_EXISTS", "Ein Ordner mit diesem Namen existiert bereits.", 409);
  }
  if (existing && !fileShare) {
    const unique = await uniqueFileName(path.dirname(dest.absPath), dest.name);
    dest = resolveUserPath(owner, joinChild(childOfShare(owner, row.virtualPath, relativeDir).virtualPath, unique));
    existing = null;
  }
  const env = getEnv();
  const written = await writeStreamToFile(dest.absPath, stream, env.maxUploadBytes, existing ? "w" : "wx");
  return { name: dest.name, size: written };
}
