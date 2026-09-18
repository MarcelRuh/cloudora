import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browseLinuxDirectories } from "@/server/storage/browse-linux";
import { configuredPathNeedsHostBind, filesystemPathOnHostStorage, remapConfiguredOntoHostStorage } from "@/server/storage/host-storage";
import { detectHostRoot, isHostBrowseFsPath, toDisplayPath, toFilesystemPath } from "@/server/storage/host-fs";
import { hostDataMount, hostDataRootFor, isHostDataPath, isHostDataRoot } from "@/server/storage/host-data";

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

describe("host data roots", () => {
  it("recognizes /mnt without extra volumes", () => {
    expect(isHostDataPath("/mnt/cloudora")).toBe(true);
    expect(isHostDataPath("/media/usb")).toBe(true);
    expect(isHostDataRoot("/mnt")).toBe(true);
    expect(isHostDataRoot("/mnt/cloudora")).toBe(false);
    expect(hostDataRootFor("/mnt/cloudora/fotos")).toBe("/mnt");
    expect(hostDataMount("/mnt/cloudora")?.hostPath).toBe("/mnt/cloudora");
  });

  it("maps host storage bind onto the container volume", () => {
    expect(remapConfiguredOntoHostStorage("/mnt/cloudora", "/mnt/cloudora", "shared")).toBe("shared");
    expect(remapConfiguredOntoHostStorage("/mnt/cloudora/fotos", "/mnt/cloudora", "shared")).toBe("fotos");
    expect(filesystemPathOnHostStorage("/mnt/cloudora", "/mnt/cloudora", "/storage")).toBe("/storage");
    expect(filesystemPathOnHostStorage("/mnt/cloudora/users", "/mnt/cloudora", "/storage")).toBe("/storage/users");
  });

  it("does not need a compose extra-bind for /mnt", () => {
    const prev = process.env.CLOUDORA_RUNTIME;
    process.env.CLOUDORA_RUNTIME = "docker";
    try {
      expect(configuredPathNeedsHostBind("/mnt/cloudora", "/storage")).toBe(false);
      expect(configuredPathNeedsHostBind("/mnt/other", "/storage")).toBe(false);
      expect(configuredPathNeedsHostBind("shared", "/storage")).toBe(false);
      expect(configuredPathNeedsHostBind("/home/data", "/storage")).toBe(true);
    } finally {
      if (prev == null) delete process.env.CLOUDORA_RUNTIME;
      else process.env.CLOUDORA_RUNTIME = prev;
    }
  });
});
