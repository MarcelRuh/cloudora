import { statfs } from "node:fs/promises";
import path from "node:path";
import { extraVolumeLiveRoot, type ExtraVolume } from "@/server/storage/extra-volumes";

export type VolumeStats = {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
};

export type DiskSnapshot = {
  id: string;
  name: string;
  hostPath?: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
};

export function volumeStatsFromStatfs(input: {
  bsize: number;
  blocks: number;
  bavail: number;
  bfree?: number;
}): VolumeStats {
  const bsize = Number(input.bsize) || 0;
  const blocks = Number(input.blocks) || 0;
  const bavail = Number(input.bavail) || 0;
  const bfree = Number(input.bfree ?? input.bavail) || 0;
  return {
    totalBytes: blocks * bsize,
    usedBytes: Math.max(0, (blocks - bfree) * bsize),
    freeBytes: bavail * bsize,
  };
}

export function diskWarning(stats: Pick<VolumeStats, "totalBytes" | "freeBytes">, minFreeBytes = 1024 ** 3, minFreeRatio = 0.1): boolean {
  if (stats.totalBytes <= 0) return false;
  if (stats.freeBytes < minFreeBytes) return true;
  return stats.freeBytes / stats.totalBytes < minFreeRatio;
}

export async function volumeStats(absPath: string): Promise<VolumeStats | null> {
  try {
    const raw = await statfs(absPath);
    const stats = volumeStatsFromStatfs({
      bsize: Number(raw.bsize),
      blocks: Number(raw.blocks),
      bavail: Number(raw.bavail),
      bfree: Number(raw.bfree),
    });
    if (stats.totalBytes <= 0) return null;
    return stats;
  } catch {
    return null;
  }
}

function fingerprint(stats: VolumeStats): string {
  return `${stats.totalBytes}:${stats.freeBytes}:${stats.usedBytes}`;
}

export async function listStorageDisks(input: {
  storagePath: string;
  hostStorage: string;
  extraVolumes: ExtraVolume[];
}): Promise<DiskSnapshot[]> {
  const disks: DiskSnapshot[] = [];
  const seen = new Set<string>();
  const push = async (id: string, name: string, absPath: string, hostPath?: string) => {
    const stats = await volumeStats(absPath);
    if (!stats) return;
    const key = fingerprint(stats);
    if (seen.has(key)) return;
    seen.add(key);
    disks.push({
      id,
      name,
      hostPath,
      totalBytes: stats.totalBytes,
      usedBytes: stats.usedBytes,
      freeBytes: stats.freeBytes,
    });
  };

  await push("storage", "Cloudora", input.storagePath, input.hostStorage || undefined);
  for (const vol of input.extraVolumes) {
    const live = extraVolumeLiveRoot(vol, input.storagePath);
    await push(vol.id, vol.name, live, vol.hostPath);
  }
  return disks;
}
