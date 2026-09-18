import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertQuotaLimit, countsTowardQuota } from "@/server/storage/quota";
import type { StorageScope } from "@/server/storage/path-resolver";

const scope: StorageScope = {
  kind: "global",
  jailRoot: "/tmp",
  catalogOnly: true,
  rootLabel: "Dateien",
  extraRoots: [
    { virtualRoot: "/Home", absRoot: "/tmp/home", writable: true, label: "Home", kind: "home" },
    { virtualRoot: "/share", absRoot: "/tmp/share", writable: true, label: "Share", kind: "share" },
  ],
};

describe("quota", () => {
  it("allows uploads under quota", () => {
    expect(() => assertQuotaLimit(800, 1000, 100)).not.toThrow();
  });

  it("blocks uploads over quota with details", () => {
    try {
      assertQuotaLimit(800, 1000, 500);
      throw new Error("expected quota error");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "QUOTA_EXCEEDED",
        details: { availableBytes: 200, fileBytes: 500 },
      });
      expect((error as AppError).message).toContain("Speicherlimit");
    }
  });

  it("allows unlimited quota", () => {
    expect(() => assertQuotaLimit(800, null, 9_000_000_000)).not.toThrow();
  });

  it("counts only home paths toward quota", () => {
    expect(countsTowardQuota({ scope, virtualPath: "/Home/foto.jpg" })).toBe(true);
    expect(countsTowardQuota({ scope, virtualPath: "/share/foto.jpg" })).toBe(false);
  });
});
