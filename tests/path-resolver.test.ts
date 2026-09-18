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

  it("resolves a named share via extraRoots, not the jail", () => {
    const mnt = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-mnt-"));
    fs.mkdirSync(path.join(mnt, "cloudora"));
    const resolved = resolveScopedPath(
      {
        kind: "global",
        jailRoot: jail,
        catalogOnly: true,
        extraRoots: [
          {
            virtualRoot: "/daten",
            absRoot: mnt,
            writable: true,
            label: "Daten",
            kind: "share",
          },
        ],
        rootLabel: "Dateien",
      },
      "/daten/cloudora",
    );
    expect(resolved.absPath).toBe(fs.realpathSync(path.join(mnt, "cloudora")));
    expect(resolved.name).toBe("cloudora");
  });

  it("rejects catalog paths that are not shares", () => {
    expect(() =>
      resolveScopedPath({ kind: "global", jailRoot: jail, catalogOnly: true, extraRoots: [], rootLabel: "Dateien" }, "/etc"),
    ).toThrow(AppError);
  });

  it("allows a nested extra root without parent folders", () => {
    const mnt = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-nested-"));
    fs.mkdirSync(path.join(mnt, "shared", "test"), { recursive: true });
    const scope = {
      kind: "global" as const,
      jailRoot: jail,
      catalogOnly: true,
      extraRoots: [
        {
          virtualRoot: "/cloudora/shared/test",
          absRoot: path.join(mnt, "shared", "test"),
          writable: true,
          label: "test",
          kind: "share" as const,
        },
      ],
      rootLabel: "Dateien",
    };
    const resolved = resolveScopedPath(scope, "/cloudora/shared/test");
    expect(resolved.absPath).toBe(fs.realpathSync(path.join(mnt, "shared", "test")));
    expect(resolved.name).toBe("test");
    expect(() => resolveScopedPath(scope, "/cloudora")).toThrow(AppError);
    expect(() => resolveScopedPath(scope, "/cloudora/shared")).toThrow(AppError);
  });

  it("resolves an extra root that does not exist yet", () => {
    const mnt = fs.mkdtempSync(path.join(os.tmpdir(), "cloudora-missing-"));
    const absRoot = path.join(mnt, "users", "test");
    const resolved = resolveScopedPath(
      {
        kind: "global",
        jailRoot: jail,
        catalogOnly: true,
        extraRoots: [
          {
            virtualRoot: "/Home",
            absRoot,
            writable: true,
            label: "Home",
            kind: "home",
          },
        ],
        rootLabel: "Dateien",
      },
      "/Home",
    );
    expect(resolved.absPath).toBe(path.resolve(absRoot));
    expect(resolved.name).toBe("Home");
  });
});
