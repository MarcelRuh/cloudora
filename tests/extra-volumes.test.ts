import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { browseLinuxDirectories } from "@/server/storage/browse-linux";
import {
  AUTO_SHARED_VOLUME_ID,
  configuredPathNeedsHostBind,
  extraVolumeContainerPath,
  extraVolumeForChildName,
  extraVolumesComposeYaml,
  extraVolumesFingerprint,
  isExtraVolumeRoot,
  normalizeExtraVolume,
  parseExtraVolumes,
  resolveThroughExtraVolumes,
  slugifyVolumeId,
  suggestVolumeName,
  syncAutoExtraVolumes,
} from "@/server/storage/extra-volumes";
import { filesystemPathOnHostStorage, remapConfiguredOntoHostStorage } from "@/server/storage/host-storage";
import { detectHostRoot, isHostBrowseFsPath, toDisplayPath, toFilesystemPath } from "@/server/storage/host-fs";

describe("host fs mapping", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.CLOUDORA_HOST_ROOT;
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("maps display paths through CLOUDORA_HOST_ROOT", () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-host-"));
    dirs.push(host);
    fs.mkdirSync(path.join(host, "mnt"));
    fs.mkdirSync(path.join(host, "mnt", "hdd"));
    process.env.CLOUDORA_HOST_ROOT = host;
    expect(detectHostRoot()).toBe(path.resolve(host));
    expect(toFilesystemPath("/", host)).toBe(path.resolve(host));
    expect(toFilesystemPath("/mnt/hdd", host)).toBe(path.join(path.resolve(host), "mnt/hdd"));
    expect(toDisplayPath(path.join(host, "mnt/hdd"), host)).toBe("/mnt/hdd");
    expect(toFilesystemPath("/mnt/hdd", host, { mounts: ["/mnt"] })).toBe("/mnt/hdd");
    expect(toFilesystemPath("/mnt/hdd", host, { mounts: [] })).toBe(path.join(path.resolve(host), "mnt/hdd"));
    expect(toFilesystemPath("/storage/users", host, { mounts: [] })).toBe(path.resolve("/storage/users"));
    expect(isHostBrowseFsPath(path.join(host, "mnt/hdd"), host)).toBe(true);
    expect(isHostBrowseFsPath("/storage/users", host)).toBe(false);
  });

  it("lists host root as / including mnt", () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-hostlist-"));
    dirs.push(host);
    fs.mkdirSync(path.join(host, "mnt"));
    fs.mkdirSync(path.join(host, "home"));
    process.env.CLOUDORA_HOST_ROOT = host;
    const result = browseLinuxDirectories("/");
    expect(result.path).toBe("/");
    expect(result.parent).toBeNull();
    expect(result.entries.some((e) => e.name === "mnt" && e.path === "/mnt")).toBe(true);
    expect(result.entries.some((e) => e.name === "home" && e.path === "/home")).toBe(true);
  });
});

describe("extra volumes", () => {
  it("names a volume from the last host-path segment", () => {
    expect(suggestVolumeName("/mnt/nas/photos")).toBe("photos");
    expect(suggestVolumeName("/media/usb")).toBe("usb");
    expect(suggestVolumeName("/srv/daten/")).toBe("daten");
    expect(suggestVolumeName("/")).toBe("daten");
    expect(normalizeExtraVolume({ id: "photos", name: "", hostPath: "/mnt/nas/photos" }).name).toBe("photos");
  });

  it("normalizes ids and rejects root", () => {
    expect(slugifyVolumeId("NAS Photos")).toBe("nas-photos");
    expect(normalizeExtraVolume({ id: "hdd", name: "HDD", hostPath: "/mnt/hdd" })).toEqual({
      id: "hdd",
      name: "HDD",
      hostPath: "/mnt/hdd",
    });
    expect(() => normalizeExtraVolume({ id: "root", name: "root", hostPath: "/" })).toThrow(AppError);
    expect(() => normalizeExtraVolume({ id: "users", name: "users", hostPath: "/mnt/x" })).toThrow(AppError);
  });

  it("maps host storage bind onto the container volume", () => {
    expect(remapConfiguredOntoHostStorage("/mnt/cloudora", "/mnt/cloudora", "shared")).toBe("shared");
    expect(remapConfiguredOntoHostStorage("/mnt/cloudora/fotos", "/mnt/cloudora", "shared")).toBe("fotos");
    expect(filesystemPathOnHostStorage("/mnt/cloudora", "/mnt/cloudora", "/storage")).toBe("/storage");
    expect(filesystemPathOnHostStorage("/mnt/cloudora/users", "/mnt/cloudora", "/storage")).toBe("/storage/users");
  });

  it("maps host paths through extra volumes and syncs auto binds", () => {
    expect(configuredPathNeedsHostBind("/mnt/clustern", "/storage")).toBe(true);
    expect(configuredPathNeedsHostBind("shared", "/storage")).toBe(false);
    expect(configuredPathNeedsHostBind("/storage/shared", "/storage")).toBe(false);
    const volumes = syncAutoExtraVolumes([], "/storage", "users", "/mnt/clustern");
    expect(volumes).toEqual([
      { id: AUTO_SHARED_VOLUME_ID, name: "Shared-Ordner", hostPath: "/mnt/clustern" },
    ]);
    expect(resolveThroughExtraVolumes("/mnt/clustern", "/storage", volumes)).toBe("/storage/volumes/shared-host");
    expect(resolveThroughExtraVolumes("/mnt/clustern/docs", "/storage", volumes)).toBe(
      "/storage/volumes/shared-host/docs",
    );
    expect(resolveThroughExtraVolumes("users", "/storage", volumes)).toBe(path.resolve("/storage/users"));
    const reused = syncAutoExtraVolumes(
      [{ id: "hdd", name: "HDD", hostPath: "/mnt/clustern" }],
      "/storage",
      "users",
      "/mnt/clustern",
    );
    expect(reused).toHaveLength(1);
    expect(reused[0]?.id).toBe("hdd");
    expect(extraVolumesFingerprint(volumes)).not.toBe(extraVolumesFingerprint([]));
  });

  it("does not extra-bind the compose host storage path", () => {
    expect(configuredPathNeedsHostBind("/mnt/cloudora", "/storage", "/mnt/cloudora")).toBe(false);
    expect(configuredPathNeedsHostBind("/mnt/other", "/storage", "/mnt/cloudora")).toBe(true);
    expect(syncAutoExtraVolumes([], "/storage", "users", "/mnt/cloudora", "/mnt/cloudora")).toEqual([]);
  });

  it("parses and renders compose yaml without wiping service volumes when empty", () => {
    expect(parseExtraVolumes([{ id: "hdd", name: "HDD", hostPath: "/mnt/hdd" }])).toHaveLength(1);
    expect(extraVolumesComposeYaml([], "/storage")).toContain("services: {}");
    expect(extraVolumesComposeYaml([], "/storage")).not.toContain("volumes:");
    const yaml = extraVolumesComposeYaml(
      [{ id: "hdd", name: "HDD", hostPath: "/mnt/hdd" }],
      "/storage",
    );
    expect(yaml).toContain("/mnt/hdd:/storage/volumes/hdd");
    expect(extraVolumeContainerPath("/storage", "hdd")).toBe("/storage/volumes/hdd");
    expect(extraVolumeForChildName("/storage/volumes", "hdd", "/storage", [{ id: "hdd", name: "HDD", hostPath: "/mnt/hdd" }])?.name).toBe(
      "HDD",
    );
    expect(isExtraVolumeRoot("/storage/volumes/hdd", "/storage", [{ id: "hdd", name: "HDD", hostPath: "/mnt/hdd" }])).toBe(true);
    expect(isExtraVolumeRoot("/storage/volumes/hdd/docs", "/storage", [{ id: "hdd", name: "HDD", hostPath: "/mnt/hdd" }])).toBe(false);
  });
});
