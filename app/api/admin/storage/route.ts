import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { directorySize } from "@/server/storage/fs";
import { ensureStorageLayout, storageRoot } from "@/server/storage/scope";
import {
  hydrateStoragePaths,
  inspectPath,
  saveStoragePaths,
} from "@/server/storage/config";
import { getEnv } from "@/server/env";
import { prisma } from "@/server/db";
import { inspectLinuxPath } from "@/server/storage/browse-linux";
import { isMountPoint } from "@/server/storage/host-fs";
import {
  AUTO_SHARED_VOLUME_ID,
  AUTO_USERS_VOLUME_ID,
  configuredPathNeedsHostBind,
  ensureExtraVolumeDirs,
  extraVolumeBinds,
  extraVolumeContainerPath,
  extraVolumesFingerprint,
  hydrateExtraVolumes,
  requestComposeApply,
  saveExtraVolumes,
  syncAutoExtraVolumes,
} from "@/server/storage/extra-volumes";

export async function GET() {
  try {
    await requirePermission("system.view");
    const env = getEnv();
    const paths = await hydrateStoragePaths();
    const root = storageRoot();
    const used = await directorySize(root, root).catch(() => BigInt(0));
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
    const extras = await hydrateExtraVolumes();
    const binds = extraVolumeBinds(paths.storagePath, extras);
    return jsonOk({
      storagePath: paths.storagePath,
      hostStorage: env.hostStorage,
      usersDir: paths.usersDir,
      sharedDir: paths.sharedDir,
      extraVolumes: extras,
      storageStatus: inspectPath(paths.storagePath),
      usersDirStatus: inspectLinuxPath(paths.usersDir, paths.storagePath, binds),
      sharedDirStatus: inspectLinuxPath(paths.sharedDir, paths.storagePath, binds),
      usedBytes: Number(used),
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
    const previous = await hydrateExtraVolumes();
    const paths = await saveStoragePaths(body);
    const synced = syncAutoExtraVolumes(previous, paths.storagePath, paths.usersDir, paths.sharedDir);
    const volumesChanged = extraVolumesFingerprint(synced) !== extraVolumesFingerprint(previous);
    if (volumesChanged) {
      await saveExtraVolumes(synced);
    }
    ensureExtraVolumeDirs(paths.storagePath, synced);
    ensureStorageLayout();
    const needsBind =
      configuredPathNeedsHostBind(paths.usersDir, paths.storagePath) ||
      configuredPathNeedsHostBind(paths.sharedDir, paths.storagePath);
    const bindPending = synced
      .filter(
        (vol) =>
          vol.hostPath === paths.usersDir ||
          vol.hostPath === paths.sharedDir ||
          vol.id === AUTO_USERS_VOLUME_ID ||
          vol.id === AUTO_SHARED_VOLUME_ID,
      )
      .some((vol) => !isMountPoint(extraVolumeContainerPath(paths.storagePath, vol.id)));
    let apply: { mode: "sidecar" | "manual"; message: string } | null = null;
    if (needsBind && (volumesChanged || bindPending)) {
      apply = requestComposeApply(synced, paths.storagePath);
    }
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
      extraVolumes: synced,
      apply,
      storageStatus: inspectPath(paths.storagePath),
    });
  } catch (error) {
    return jsonError(error);
  }
}
