import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  USER_PERMISSIONS,
  userHasPermission,
  type PermissionHolder,
} from "@/lib/permissions";

const admin: PermissionHolder = {
  role: { slug: "administrator", permissions: ALL_PERMISSIONS },
  canUpload: false,
};

const user: PermissionHolder = {
  role: { slug: "user", permissions: USER_PERMISSIONS },
  canUpload: true,
  canDownload: true,
  canDelete: false,
  canEdit: true,
  canShare: false,
  canOneTimeDownload: true,
};

describe("permissions", () => {
  it("lets admins bypass capability flags", () => {
    expect(userHasPermission(admin, "files.upload")).toBe(true);
    expect(userHasPermission(admin, "users.delete")).toBe(true);
  });

  it("honors user capability flags", () => {
    expect(userHasPermission(user, "files.read")).toBe(true);
    expect(userHasPermission(user, "files.upload")).toBe(true);
    expect(userHasPermission(user, "files.delete")).toBe(false);
    expect(userHasPermission(user, "shares.create")).toBe(false);
    expect(userHasPermission(user, "users.view")).toBe(false);
  });

  it("denies missing role permissions", () => {
    const limited: PermissionHolder = {
      role: { slug: "user", permissions: ["files.read"] },
      canUpload: true,
    };
    expect(userHasPermission(limited, "files.upload")).toBe(false);
  });
});
