import { prisma } from "@/server/db";
import { userHasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { directorySize } from "@/server/storage/fs";
import { storageRoot } from "@/server/storage/scope";

export async function dashboardStats(user: SessionUser) {
  const [fileCount, folderCount, userCount, recent] = await Promise.all([
    prisma.fileIndex.count({ where: { isDir: false } }),
    prisma.fileIndex.count({ where: { isDir: true } }),
    userHasPermission(user, "users.view") ? prisma.user.count() : Promise.resolve(null),
    prisma.auditLog.findMany({
      take: 12,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { username: true, displayName: true } } },
    }),
  ]);

  let storageUsed = user.usedBytes;
  let storageTotal: number | null = user.quotaBytes;
  if (userHasPermission(user, "system.view")) {
    try {
      const root = storageRoot();
      storageUsed = Number(await directorySize(root, root));
      storageTotal = null;
    } catch {
      /* keep user quota view */
    }
  }

  const [uploads, downloads] = await Promise.all([
    prisma.auditLog.count({
      where: { action: "UPLOAD", createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.auditLog.count({
      where: { action: "DOWNLOAD", createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return {
    storageUsed,
    storageTotal,
    quotaBytes: user.quotaBytes,
    usedBytes: user.usedBytes,
    files: fileCount,
    folders: folderCount,
    users: userCount,
    uploads7d: uploads,
    downloads7d: downloads,
    activity: recent.map((row) => ({
      id: row.id,
      action: row.action,
      target: row.target,
      result: row.result,
      createdAt: row.createdAt.toISOString(),
      user: row.user?.displayName || row.user?.username || "System",
    })),
  };
}
