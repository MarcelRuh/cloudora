import { describe, expect, it } from "vitest";
import { browseLinuxDirectories } from "@/server/storage/browse-linux";
import { toDisplayPath, toFilesystemPath } from "@/server/storage/host-fs";
import { hostDataMount, hostDataRootFor, isHostDataPath, isHostDataRoot } from "@/server/storage/host-data";

describe("host fs mapping", () => {
  it("uses native paths without a /host prefix", () => {
    expect(toFilesystemPath("/mnt/hdd")).toBe("/mnt/hdd");
    expect(toDisplayPath("/mnt/hdd")).toBe("/mnt/hdd");
    expect(toFilesystemPath("/storage/users")).toBe("/storage/users");
  });

  it("lists host root as / including mnt", () => {
    const result = browseLinuxDirectories("/");
    expect(result.path).toBe("/");
    expect(result.parent).toBeNull();
    expect(typeof result.writable).toBe("boolean");
  });
});

describe("host data roots", () => {
  it("recognizes /mnt without extra volumes", () => {
    expect(isHostDataPath("/mnt/cloudora")).toBe(true);
    expect(isHostDataPath("/media/usb")).toBe(true);
    expect(isHostDataRoot("/mnt")).toBe(true);
    expect(isHostDataRoot("/mnt/cloudora")).toBe(false);
    expect(hostDataRootFor("/mnt/cloudora/fotos")).toBe("/mnt");
    expect(hostDataMount("/mnt/cloudora")?.hostPath).toBe("/mnt/cloudora");
  });
});
