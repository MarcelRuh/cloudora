import { describe, expect, it } from "vitest";
import { diskWarning, volumeStatsFromStatfs } from "@/server/storage/volume";

describe("volume stats", () => {
  it("computes bytes from statfs fields", () => {
    const stats = volumeStatsFromStatfs({ bsize: 4096, blocks: 1024, bavail: 256 });
    expect(stats.totalBytes).toBe(1024 * 4096);
    expect(stats.freeBytes).toBe(256 * 4096);
    expect(stats.usedBytes).toBe((1024 - 256) * 4096);
  });

  it("warns below 1 GB or 10 percent", () => {
    expect(diskWarning({ totalBytes: 10 * 1024 ** 3, freeBytes: 2 * 1024 ** 3 })).toBe(false);
    expect(diskWarning({ totalBytes: 10 * 1024 ** 3, freeBytes: 500 * 1024 ** 2 })).toBe(true);
    expect(diskWarning({ totalBytes: 100 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 })).toBe(true);
  });
});
