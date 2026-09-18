import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { browseLinuxDirectories, inspectLinuxPath, mkdirLinuxDirectory, normalizeBrowsePath } from "@/server/storage/browse-linux";
import { isBlockedSystemPath, isWritableDir, toFilesystemPath } from "@/server/storage/host-fs";

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
    expect(result.writable).toBe(true);
  });

  it("inspects relative paths against the storage root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-inspect-"));
    fs.mkdirSync(path.join(root, "users"));
    const found = inspectLinuxPath("users", root);
    expect(found.exists).toBe(true);
    expect(found.isDirectory).toBe(true);
    expect(found.insideVolume).toBe(true);
    expect(found.configured).toBe("users");
    expect(found.writable).toBe(true);
    const missing = inspectLinuxPath("users/missing", root);
    expect(missing.exists).toBe(false);
    expect(missing.insideVolume).toBe(true);
  });

  it("reports writable for a real host directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-write-"));
    const inspected = inspectLinuxPath(root, root);
    expect(inspected.exists).toBe(true);
    expect(inspected.writable).toBe(true);
    expect(isWritableDir(root)).toBe(true);
  });

  it("creates a folder next to the browse target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-mkdir-"));
    const created = mkdirLinuxDirectory(root, "neu");
    expect(fs.statSync(created).isDirectory()).toBe(true);
    expect(() => mkdirLinuxDirectory(root, "neu")).toThrow(AppError);
    expect(() => mkdirLinuxDirectory("/", "nope")).toThrow(AppError);
  });
});

describe("native host paths", () => {
  it("does not remap through /host", () => {
    expect(toFilesystemPath("/mnt/data")).toBe(path.resolve("/mnt/data"));
    expect(isBlockedSystemPath("/proc")).toBe(true);
    expect(isBlockedSystemPath("/mnt/data")).toBe(false);
  });
});
