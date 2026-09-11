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

  it("creates a folder next to the browse target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-mkdir-"));
    const created = mkdirLinuxDirectory(root, "neu");
    expect(fs.statSync(created).isDirectory()).toBe(true);
    expect(() => mkdirLinuxDirectory(root, "neu")).toThrow(AppError);
    expect(() => mkdirLinuxDirectory("/", "nope")).toThrow(AppError);
  });
});
