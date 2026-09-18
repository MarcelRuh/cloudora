import fs from "node:fs";
import os from "node:os";
import { APP_VERSION } from "@/lib/version";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { hydrateStoragePaths } from "@/server/storage/config";
import { hydrateFolderShares, getFolderShares } from "@/server/storage/folder-shares";
import { storageRoot } from "@/server/storage/scope";
import { diskWarning, listStorageDisks, volumeStats } from "@/server/storage/volume";

const STARTED_AT = Date.now();

export async function systemInfo() {
  const env = getEnv();
  const paths = await hydrateStoragePaths();
  await hydrateFolderShares();
  const root = storageRoot();
  const disks = await listStorageDisks({
    storagePath: root,
    hostStorage: env.hostStorage,
    extraPaths: getFolderShares()
      .filter((s) => s.enabled)
      .map((s) => ({ id: s.id, name: s.name, absPath: s.hostPath })),
  });
  const volume = fs.existsSync(root) ? await volumeStats(root) : null;
  let dbOk = false;
  let dbSize: number | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
    const rows = await prisma.$queryRaw<Array<{ size: bigint }>>`
      SELECT pg_database_size(current_database()) as size
    `;
    dbSize = Number(rows[0]?.size ?? 0);
  } catch {
    dbOk = false;
  }
  return {
    app: "Cloudora",
    version: APP_VERSION,
    node: process.version,
    uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    hostname: os.hostname(),
    storagePathConfigured: paths.storagePath,
    hostStorageConfigured: env.hostStorage,
    usersDir: paths.usersDir,
    sharedDir: paths.sharedDir,
    storageExists: fs.existsSync(root),
    storageBytes: volume?.usedBytes ?? 0,
    storageTotalBytes: volume?.totalBytes ?? null,
    storageFreeBytes: volume?.freeBytes ?? null,
    storageLow: volume ? diskWarning(volume) : false,
    disks,
    database: dbOk ? "online" : "offline",
    databaseBytes: dbSize,
    docker: false,
    publicUrl: env.publicUrl,
  };
}

export async function latestGithubRelease() {
  const env = getEnv();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "cloudora",
  };
  if (env.githubToken) headers.Authorization = `Bearer ${env.githubToken}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${env.repo}/releases/latest`, { headers, cache: "no-store" });
    if (!res.ok) return { latest: null as string | null, htmlUrl: null as string | null };
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    return { latest: data.tag_name?.replace(/^v/, "") ?? null, htmlUrl: data.html_url ?? null };
  } catch {
    return { latest: null as string | null, htmlUrl: null as string | null };
  }
}
