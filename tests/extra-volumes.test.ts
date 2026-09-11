import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { browseLinuxDirectories } from "@/server/storage/browse-linux";
import {
  extraVolumeContainerPath,
  extraVolumesComposeYaml,
  normalizeExtraVolume,
  parseExtraVolumes,
  slugifyVolumeId,
} from "@/server/storage/extra-volumes";
import { detectHostRoot, toDisplayPath, toFilesystemPath } from "@/server/storage/host-fs";

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
    expect(toFilesystemPath("/storage/users", host)).toBe(path.resolve("/storage/users"));
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
  });
});
