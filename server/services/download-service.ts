import fs from "node:fs";
import { AppError } from "@/lib/errors";
import { userHasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { hashToken, randomToken } from "@/server/crypto";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { publicOrigin } from "@/server/http";
import { resolveUserPath } from "@/server/services/file-service";
import { mimeFromName } from "@/server/storage/mime";
import { statOrNull } from "@/server/storage/fs";
import { hydrateStoragePaths } from "@/server/storage/config";

function publicLink(token: string): string {
  return `${publicOrigin()}/d/${token}`;
}

export async function createOneTimeDownload(
  user: SessionUser,
  input: {
    path: string;
    expiresInHours?: number;
    maxDownloads?: number;
    password?: string;
    description?: string;
  },
) {
  if (!userHasPermission(user, "downloads.create")) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
  const resolved = resolveUserPath(user, input.path);
  const stat = await statOrNull(resolved.absPath);
  if (!stat) throw new AppError("NOT_FOUND", "Datei nicht gefunden.", 404);
  if (stat.isDirectory()) {
    throw new AppError("NOT_A_FILE", "One-Time-Downloads sind nur für einzelne Dateien verfügbar.", 400);
  }
  const hours = Math.min(Math.max(input.expiresInHours ?? 24, 1), 24 * 30);
  const maxDownloads = Math.min(Math.max(input.maxDownloads ?? 1, 1), 100);
  const token = randomToken(32);
  const row = await prisma.oneTimeDownload.create({
    data: {
      tokenHash: hashToken(token),
      createdById: user.id,
      virtualPath: resolved.virtualPath,
      name: resolved.name,
      description: input.description?.trim() ?? "",
      passwordHash: input.password ? await hashPassword(input.password) : null,
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      maxDownloads,
    },
  });
  return {
    id: row.id,
    url: publicLink(token),
    token,
    name: row.name,
    expiresAt: row.expiresAt.toISOString(),
    maxDownloads: row.maxDownloads,
    hasPassword: Boolean(row.passwordHash),
    description: row.description,
  };
}

export async function listOneTimeDownloads(user: SessionUser, all: boolean) {
  const where = all && userHasPermission(user, "downloads.manage") ? {} : { createdById: user.id };
  const rows = await prisma.oneTimeDownload.findMany({
    where,
    include: { createdBy: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    expiresAt: row.expiresAt.toISOString(),
    maxDownloads: row.maxDownloads,
    downloadCount: row.downloadCount,
    hasPassword: Boolean(row.passwordHash),
    revoked: Boolean(row.revokedAt),
    valid: isDownloadValid(row),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    lastDownloadedAt: row.lastDownloadedAt?.toISOString() ?? null,
    lastIp: row.lastIp,
  }));
}

function isDownloadValid(row: {
  revokedAt: Date | null;
  expiresAt: Date;
  downloadCount: number;
  maxDownloads: number;
}): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() <= Date.now()) return false;
  if (row.downloadCount >= row.maxDownloads) return false;
  return true;
}

export async function revokeOneTimeDownload(user: SessionUser, id: string) {
  const row = await prisma.oneTimeDownload.findUnique({ where: { id } });
  if (!row) throw new AppError("NOT_FOUND", "Download-Link nicht gefunden.", 404);
  if (row.createdById !== user.id && !userHasPermission(user, "downloads.manage")) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
  await prisma.oneTimeDownload.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function inspectPublicDownload(token: string) {
  const row = await prisma.oneTimeDownload.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { createdBy: true },
  });
  if (!row) throw new AppError("INVALID_TOKEN", "Dieser Download-Link ist ungültig.", 404);
  return {
    name: row.name,
    description: row.description,
    expiresAt: row.expiresAt.toISOString(),
    hasPassword: Boolean(row.passwordHash),
    valid: isDownloadValid(row),
    remaining: Math.max(0, row.maxDownloads - row.downloadCount),
  };
}

export async function consumePublicDownload(token: string, password: string | undefined, ip: string, userAgent: string | null) {
  await hydrateStoragePaths();
  const row = await prisma.oneTimeDownload.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { createdBy: { include: { role: true } } },
  });
  if (!row) throw new AppError("INVALID_TOKEN", "Dieser Download-Link ist ungültig.", 404);
  if (!isDownloadValid(row)) {
    throw new AppError("TOKEN_EXPIRED", "Dieser Download-Link ist abgelaufen oder bereits verwendet.", 410);
  }
  if (row.passwordHash) {
    if (!password) throw new AppError("PASSWORD_REQUIRED", "Dieser Download ist passwortgeschützt.", 401);
    const ok = await verifyPassword(password, row.passwordHash);
    if (!ok) throw new AppError("INVALID_PASSWORD", "Das Passwort ist falsch.", 401);
  }
  const owner = row.createdBy;
  const resolved = resolveUserPath(
    {
      id: owner.id,
      username: owner.username,
      displayName: owner.displayName,
      email: owner.email,
      status: owner.status,
      homePathEnabled: owner.homePathEnabled,
      homePath: owner.homePath,
      quotaBytes: owner.quotaBytes == null ? null : Number(owner.quotaBytes),
      usedBytes: Number(owner.usedBytes),
      canUpload: owner.canUpload,
      canDownload: owner.canDownload,
      canDelete: owner.canDelete,
      canEdit: owner.canEdit,
      canShare: owner.canShare,
      canOneTimeDownload: owner.canOneTimeDownload,
      appearance: owner.appearance,
      totpEnabled: owner.totpEnabled,
      role: {
        id: owner.role.id,
        name: owner.role.name,
        slug: owner.role.slug,
        permissions: owner.role.permissions as SessionUser["role"]["permissions"],
      },
    },
    row.virtualPath,
  );
  const stat = await statOrNull(resolved.absPath);
  if (!stat || stat.isDirectory()) {
    throw new AppError("NOT_FOUND", "Die Datei ist nicht mehr verfügbar.", 404);
  }
  const updated = await prisma.oneTimeDownload.updateMany({
    where: {
      id: row.id,
      revokedAt: null,
      downloadCount: { lt: row.maxDownloads },
      expiresAt: { gt: new Date() },
    },
    data: {
      downloadCount: { increment: 1 },
      lastDownloadedAt: new Date(),
      lastIp: ip,
      lastUserAgent: userAgent,
    },
  });
  if (updated.count !== 1) {
    throw new AppError("TOKEN_EXPIRED", "Dieser Download-Link ist abgelaufen oder bereits verwendet.", 410);
  }
  return {
    absPath: resolved.absPath,
    name: row.name,
    size: Number(stat.size),
    mime: mimeFromName(row.name),
    stream: fs.createReadStream(resolved.absPath),
    remainingAfter: row.maxDownloads - row.downloadCount - 1,
  };
}
