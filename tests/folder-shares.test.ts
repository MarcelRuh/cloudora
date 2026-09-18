import { describe, expect, it } from "vitest";
import {
  accessForShare,
  normalizeShareSlug,
  normalizeShareSubPath,
  slugifyShareName,
  visibleFoldersForUser,
  type FolderShareRecord,
} from "@/server/storage/folder-shares";
import { AppError } from "@/lib/errors";

describe("folder share names", () => {
  it("slugifies german names", () => {
    expect(slugifyShareName("Daten")).toBe("daten");
    expect(slugifyShareName("Mein NAS")).toBe("mein-nas");
    expect(slugifyShareName("Bücher")).toBe("buecher");
  });

  it("rejects reserved slugs", () => {
    expect(() => normalizeShareSlug("home", "home")).toThrow(AppError);
    expect(() => normalizeShareSlug("mnt", "mnt")).toThrow(AppError);
  });
});

describe("folder share access", () => {
  const share: FolderShareRecord = {
    id: "s1",
    name: "Daten",
    slug: "daten",
    hostPath: "/mnt/cloudora",
    comment: "",
    enabled: true,
    grants: [{ roleId: "role-user", userId: null, access: "READ" }],
  };

  it("gives administrators write access", () => {
    expect(accessForShare({ id: "a", role: { slug: "administrator", id: "role-admin" } }, share)).toBe("WRITE");
  });

  it("honors role grants", () => {
    expect(accessForShare({ id: "u", role: { slug: "user", id: "role-user" } }, share)).toBe("READ");
    expect(accessForShare({ id: "u", role: { slug: "user", id: "other" } }, share)).toBeNull();
  });

  it("honors user grants over missing role", () => {
    const withUser: FolderShareRecord = {
      ...share,
      grants: [{ userId: "u1", roleId: null, access: "WRITE" }],
    };
    expect(accessForShare({ id: "u1", role: { slug: "user", id: "role-user" } }, withUser)).toBe("WRITE");
  });

  it("does not treat nested grants as full-share access", () => {
    const nested: FolderShareRecord = {
      ...share,
      grants: [{ userId: "u1", roleId: null, access: "WRITE", subPath: "shared/test" }],
    };
    expect(accessForShare({ id: "u1", role: { slug: "user", id: "role-user" } }, nested)).toBeNull();
  });
});

describe("share subpaths", () => {
  it("normalizes relative and absolute folders inside the share", () => {
    expect(normalizeShareSubPath("shared/test", "/mnt/cloudora")).toBe("shared/test");
    expect(normalizeShareSubPath("/mnt/cloudora/shared/test", "/mnt/cloudora")).toBe("shared/test");
    expect(normalizeShareSubPath("/mnt/cloudora", "/mnt/cloudora")).toBe("");
    expect(normalizeShareSubPath("", "/mnt/cloudora")).toBe("");
  });

  it("rejects folders outside the share", () => {
    expect(() => normalizeShareSubPath("/mnt/other", "/mnt/cloudora")).toThrow(AppError);
    expect(() => normalizeShareSubPath("../etc", "/mnt/cloudora")).toThrow(AppError);
  });
});

describe("visible folders", () => {
  const share: FolderShareRecord = {
    id: "s1",
    name: "cloudora",
    slug: "cloudora",
    hostPath: "/mnt/cloudora",
    comment: "",
    enabled: true,
    grants: [{ userId: "u1", roleId: null, access: "WRITE", subPath: "shared/test" }],
  };

  it("exposes only the granted nested folder, not the parent", () => {
    const folders = visibleFoldersForUser({ id: "u1", role: { slug: "user", id: "role-user" } }, share);
    expect(folders).toEqual([
      {
        subPath: "shared/test",
        access: "WRITE",
        label: "test",
        virtualRoot: "/cloudora/shared/test",
        absRoot: "/mnt/cloudora/shared/test",
      },
    ]);
  });

  it("uses the full share when a full grant exists", () => {
    const full: FolderShareRecord = {
      ...share,
      grants: [
        { userId: "u1", roleId: null, access: "READ", subPath: "" },
        { userId: "u1", roleId: null, access: "WRITE", subPath: "shared/test" },
      ],
    };
    const folders = visibleFoldersForUser({ id: "u1", role: { slug: "user", id: "role-user" } }, full);
    expect(folders).toHaveLength(1);
    expect(folders[0]?.subPath).toBe("");
    expect(folders[0]?.virtualRoot).toBe("/cloudora");
  });
});
