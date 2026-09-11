import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isInsideRoot,
  normalizeVirtualPath,
  resolveScopedPath,
  childVirtual,
} from "@/server/storage/path-resolver";
import { AppError } from "@/lib/errors";

describe("normalizeVirtualPath", () => {
  it("normalizes slashes and dots", () => {
    expect(normalizeVirtualPath("/a/./b")).toBe("/a/b");
    expect(normalizeVirtualPath("a/b")).toBe("/a/b");
    expect(normalizeVirtualPath("/")).toBe("/");
  });

  it("rejects traversal", () => {
    expect(() => normalizeVirtualPath("../etc/passwd")).toThrow(AppError);
    expect(() => normalizeVirtualPath("/ok/../../etc/passwd")).toThrow(AppError);
    expect(() => normalizeVirtualPath("/ok/../../../etc/passwd")).toThrow(AppError);
    expect(() => normalizeVirtualPath("..\\..\\windows")).toThrow(AppError);
  });

  it("rejects null bytes and schemes", () => {
    expect(() => normalizeVirtualPath("/a\0/b")).toThrow(AppError);
    expect(() => normalizeVirtualPath("file:///etc/passwd")).toThrow(AppError);
  });
});

describe("resolveScopedPath jail", () => {
  const jail = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-jail-"));

  it("stays inside the jail", () => {
    const resolved = resolveScopedPath({ kind: "home", jailRoot: jail, rootLabel: "Home" }, "/docs/a.txt");
    expect(resolved.absPath.startsWith(path.resolve(jail))).toBe(true);
    expect(isInsideRoot(path.resolve(jail), resolved.absPath)).toBe(true);
  });

  it("cannot escape via encoded traversal", () => {
    expect(() =>
      resolveScopedPath({ kind: "home", jailRoot: jail, rootLabel: "Home" }, "/%2e%2e/%2e%2e/etc/passwd"),
    ).toThrow(AppError);
  });

  it("rejects the virtual trash path", () => {
    expect(() => resolveScopedPath({ kind: "home", jailRoot: jail, rootLabel: "Home" }, "/.trash")).toThrow(AppError);
    expect(() => resolveScopedPath({ kind: "home", jailRoot: jail, rootLabel: "Home" }, "/.trash/x")).toThrow(AppError);
  });

  it("builds safe children", () => {
    expect(childVirtual("/docs", "file.txt")).toBe("/docs/file.txt");
    expect(() => childVirtual("/docs", "../x")).toThrow(AppError);
  });
});
