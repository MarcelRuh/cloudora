import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { browseLinuxDirectories, inspectLinuxPath, mkdirLinuxDirectory, normalizeBrowsePath } from "@/server/storage/browse-linux";

describe("linux folder browse", () => {
  it("normalizes and rejects traversal", () => {
    expect(normalizeBrowsePath("/home")).toBe("/home");
    expect(() => normalizeBrowsePath("/tmp/../etc")).toThrow(AppError);
    expect(() => normalizeBrowsePath("/proc")).toThrow(AppError);
  });

  it("treats filesystem root as a valid browse target", () => {
    expect(normalizeBrowsePath("/")).toBe("/");
    expect(normalizeBrowsePath("")).toBe("/");
    const result = browseLinuxDirectories("/");
    expect(result.path).toBe("/");
    expect(result.parent).toBeNull();
    expect(result.entries.some((e) => e.name === "proc")).toBe(false);
  });

  it("lists directories in a temp folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-browse-"));
    fs.mkdirSync(path.join(root, "alpha"));
    fs.mkdirSync(path.join(root, ".hidden"));
    fs.writeFileSync(path.join(root, "file.txt"), "x");
    const result = browseLinuxDirectories(root);
    expect(result.path).toBe(fs.realpathSync(root));
    expect(result.entries.some((e) => e.name === "alpha")).toBe(true);
    expect(result.entries.some((e) => e.name === ".hidden")).toBe(false);
    expect(result.entries.some((e) => e.name === "file.txt")).toBe(false);
    expect(result.truncated).toBe(false);
    expect(typeof result.writable).toBe("boolean");
  });

  it("inspects relative paths against the storage root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-inspect-"));
    fs.mkdirSync(path.join(root, "users"));
    const found = inspectLinuxPath("users", root);
    expect(found.exists).toBe(true);
    expect(found.isDirectory).toBe(true);
    expect(found.insideVolume).toBe(true);
    expect(found.configured).toBe("users");
    const missing = inspectLinuxPath("users/missing", root);
    expect(missing.exists).toBe(false);
    expect(missing.insideVolume).toBe(true);
  });

  it("treats the compose host-storage path as the writable volume", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-hostvol-"));
    try {
      const inspected = inspectLinuxPath("/mnt/cloudora", root, [], "/mnt/cloudora");
      expect(inspected.insideVolume).toBe(true);
      expect(inspected.hostBrowse).toBe(false);
      expect(inspected.exists).toBe(true);
      expect(inspected.writable).toBe(true);
      expect(inspected.live).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats host-browse paths as not writable until a live bind exists", () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-hostinspect-"));
    fs.mkdirSync(path.join(host, "mnt"));
    fs.mkdirSync(path.join(host, "mnt", "clustern"));
    process.env.CLOUDORA_HOST_ROOT = host;
    try {
      const inspected = inspectLinuxPath("/mnt/clustern", "/storage");
      expect(inspected.exists).toBe(true);
      expect(inspected.isDirectory).toBe(true);
      expect(inspected.hostBrowse).toBe(true);
      expect(inspected.writable).toBe(false);
      expect(inspected.linked).toBe(false);
      expect(inspected.live).toBe(false);
      const bound = inspectLinuxPath("/mnt/clustern", "/storage", [
        { id: "shared-host", hostPath: "/mnt/clustern", containerPath: path.join(host, "mnt", "clustern") },
      ]);
      expect(bound.linked).toBe(true);
      expect(bound.writable).toBe(false);
    } finally {
      delete process.env.CLOUDORA_HOST_ROOT;
      fs.rmSync(host, { recursive: true, force: true });
    }
  });

  it("creates a folder next to the browse target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-mkdir-"));
    const created = mkdirLinuxDirectory(root, "neu");
    expect(fs.statSync(created).isDirectory()).toBe(true);
    expect(() => mkdirLinuxDirectory(root, "neu")).toThrow(AppError);
    expect(() => mkdirLinuxDirectory("/", "nope")).toThrow(AppError);
  });

  it("creates a folder through an extra-volume bind instead of host browse", () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-hostmkdir-"));
    const live = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-livemkdir-"));
    fs.mkdirSync(path.join(host, "mnt"));
    fs.mkdirSync(path.join(host, "mnt", "hdd"));
    process.env.CLOUDORA_HOST_ROOT = host;
    try {
      const created = mkdirLinuxDirectory("/mnt/hdd", "neu", [
        { id: "hdd", hostPath: "/mnt/hdd", containerPath: live },
      ]);
      expect(created).toBe("/mnt/hdd/neu");
      expect(fs.statSync(path.join(live, "neu")).isDirectory()).toBe(true);
      expect(fs.existsSync(path.join(host, "mnt", "hdd", "neu"))).toBe(false);
    } finally {
      delete process.env.CLOUDORA_HOST_ROOT;
      fs.rmSync(host, { recursive: true, force: true });
      fs.rmSync(live, { recursive: true, force: true });
    }
  });
});
