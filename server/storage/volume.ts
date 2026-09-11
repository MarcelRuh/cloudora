import { statfs } from "node:fs/promises";

export type VolumeStats = {
  totalBytes: number;
  freeBytes: number;
};

export function volumeStatsFromStatfs(input: { bsize: number; blocks: number; bavail: number }): VolumeStats {
  const bsize = Number(input.bsize) || 0;
  return {
    totalBytes: Number(input.blocks) * bsize,
    freeBytes: Number(input.bavail) * bsize,
  };
}

export function diskWarning(stats: VolumeStats, minFreeBytes = 1024 ** 3, minFreeRatio = 0.1): boolean {
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
    });
    if (stats.totalBytes <= 0) return null;
    return stats;
  } catch {
    return null;
  }
}
