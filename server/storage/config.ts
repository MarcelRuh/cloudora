import path from "node:path";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { AppError } from "@/lib/errors";
import { isBuildPhase } from "@/lib/utils";
import { isAbsolutePosixPath, normalizeConfiguredPath } from "@/server/storage/configured-path";
import { extraVolumeBinds, getCachedExtraVolumes, hydrateExtraVolumes, remapConfiguredOntoHostStorage, resolveThroughExtraVolumes } from "@/server/storage/extra-volumes";
import { inspectLinuxPath } from "@/server/storage/browse-linux";

export const STORAGE_PATHS_KEY = "storage.paths";

export type StoragePaths = {
  storagePath: string;
  usersDir: string;
  sharedDir: string;
};

let cached: StoragePaths | null = null;
let loadedFromDb = false;

function fromEnv(): StoragePaths {
  const env = getEnv();
  return {
    storagePath: path.resolve(env.storagePath),
    usersDir: env.usersDir,
    sharedDir: env.sharedDir,
  };
}

export function getStoragePaths(): StoragePaths {
  return cached ?? fromEnv();
}

export function storageRootAbs(): string {
  return path.resolve(getStoragePaths().storagePath);
}

export function usersDirName(): string {
  return getStoragePaths().usersDir;
}

export function sharedDirName(): string {
  return getStoragePaths().sharedDir;
}

export function resolveUsersDirAbs(): string {
  const cfg = getStoragePaths();
  return resolveThroughExtraVolumes(cfg.usersDir, cfg.storagePath, getCachedExtraVolumes());
}

export function resolveSharedDirAbs(): string {
  const cfg = getStoragePaths();
  return resolveThroughExtraVolumes(cfg.sharedDir, cfg.storagePath, getCachedExtraVolumes());
}

export function inspectPath(absPath: string): { exists: boolean; isDirectory: boolean; writable: boolean } {
  const cfg = getStoragePaths();
  const inspected = inspectLinuxPath(
    absPath,
    cfg.storagePath,
    extraVolumeBinds(cfg.storagePath, getCachedExtraVolumes()),
    getEnv().hostStorage,
  );
  return { exists: inspected.exists, isDirectory: inspected.isDirectory, writable: inspected.writable };
}

function parseStored(value: unknown): Partial<StoragePaths> {
  if (!value || typeof value !== "object") return {};
  const rec = value as Record<string, unknown>;
  return {
    storagePath: typeof rec.storagePath === "string" ? rec.storagePath : undefined,
    usersDir: typeof rec.usersDir === "string" ? rec.usersDir : undefined,
    sharedDir: typeof rec.sharedDir === "string" ? rec.sharedDir : undefined,
  };
}

export async function hydrateStoragePaths(): Promise<StoragePaths> {
  if (loadedFromDb && cached) {
    await hydrateExtraVolumes();
    return cached;
  }
  const base = fromEnv();
  if (isBuildPhase()) {
    cached = base;
    return cached;
  }
  try {
    const row = await prisma.setting.findUnique({ where: { key: STORAGE_PATHS_KEY } });
    const stored = parseStored(row?.value);
    cached = {
      storagePath: stored.storagePath
        ? path.resolve(normalizeConfiguredPath(stored.storagePath, base.storagePath))
        : base.storagePath,
      usersDir: stored.usersDir ? normalizeConfiguredPath(stored.usersDir, base.usersDir) : base.usersDir,
      sharedDir: stored.sharedDir ? normalizeConfiguredPath(stored.sharedDir, base.sharedDir) : base.sharedDir,
    };
    loadedFromDb = true;
  } catch {
    cached = base;
  }
  await hydrateExtraVolumes();
  return cached;
}

export async function saveStoragePaths(input: Partial<StoragePaths>): Promise<StoragePaths> {
  const current = await hydrateStoragePaths();
  const hostStorage = getEnv().hostStorage;
  const next: StoragePaths = {
    storagePath:
      input.storagePath != null
        ? path.resolve(
            requireAbsolutePath(
              remapConfiguredOntoHostStorage(input.storagePath, hostStorage, current.storagePath),
            ),
          )
        : current.storagePath,
    usersDir:
      input.usersDir != null
        ? normalizeConfiguredPath(remapConfiguredOntoHostStorage(input.usersDir, hostStorage, "users"), current.usersDir)
        : current.usersDir,
    sharedDir:
      input.sharedDir != null
        ? normalizeConfiguredPath(
            remapConfiguredOntoHostStorage(input.sharedDir, hostStorage, "shared"),
            current.sharedDir,
          )
        : current.sharedDir,
  };
  await prisma.setting.upsert({
    where: { key: STORAGE_PATHS_KEY },
    update: { value: next },
    create: { key: STORAGE_PATHS_KEY, value: next },
  });
  cached = next;
  loadedFromDb = true;
  return next;
}

function requireAbsolutePath(input: string): string {
  const normalized = normalizeConfiguredPath(input);
  if (!isAbsolutePosixPath(normalized)) {
    throw new AppError("INVALID_PATH", "Der Storage-Root muss ein absoluter Pfad sein, z. B. /storage oder /home.", 400);
  }
  return normalized;
}
