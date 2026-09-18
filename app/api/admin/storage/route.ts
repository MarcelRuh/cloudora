import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { ensureStorageLayout, storageRoot } from "@/server/storage/scope";
import { hydrateStoragePaths, inspectPath, saveStoragePaths } from "@/server/storage/config";
import { getEnv } from "@/server/env";
import { prisma } from "@/server/db";
import { inspectLinuxPath } from "@/server/storage/browse-linux";
import { hydrateFolderShares, getFolderShares } from "@/server/storage/folder-shares";
import { listStorageDisks } from "@/server/storage/volume";

export async function GET() {
  try {
    await requirePermission("system.view");
    const env = getEnv();
    const paths = await hydrateStoragePaths();
    const root = storageRoot();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        homePath: true,
        homePathEnabled: true,
        usedBytes: true,
        quotaBytes: true,
      },
      orderBy: { username: "asc" },
    });
    await hydrateFolderShares();
    const disks = await listStorageDisks({
      storagePath: root,
      hostStorage: env.hostStorage,
      extraPaths: getFolderShares()
        .filter((s) => s.enabled)
        .map((s) => ({ id: s.id, name: s.name, absPath: s.hostPath })),
    });
    const primary = disks[0];
    return jsonOk({
      storagePath: paths.storagePath,
      hostStorage: env.hostStorage,
      usersDir: paths.usersDir,
      sharedDir: paths.sharedDir,
      storageStatus: inspectPath(paths.storagePath),
      usersDirStatus: inspectLinuxPath(paths.usersDir, paths.storagePath),
      sharedDirStatus: inspectLinuxPath(paths.sharedDir, paths.storagePath),
      usedBytes: primary?.usedBytes ?? 0,
      totalBytes: primary?.totalBytes ?? null,
      freeBytes: primary?.freeBytes ?? null,
      disks,
      users: users.map((u) => ({
        ...u,
        usedBytes: Number(u.usedBytes),
        quotaBytes: u.quotaBytes == null ? null : Number(u.quotaBytes),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const patchSchema = z.object({
  storagePath: z.string().min(2).max(512).optional(),
  usersDir: z.string().min(1).max(512).optional(),
  sharedDir: z.string().min(1).max(512).optional(),
});

export async function PATCH(request: Request) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const body = await readJson(request, patchSchema);
    const paths = await saveStoragePaths(body);
    ensureStorageLayout();
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "UPDATE_STORAGE_PATHS",
      target: paths.storagePath,
    });
    return jsonOk({
      storagePath: paths.storagePath,
      usersDir: paths.usersDir,
      sharedDir: paths.sharedDir,
      storageStatus: inspectPath(paths.storagePath),
    });
  } catch (error) {
    return jsonError(error);
  }
}
