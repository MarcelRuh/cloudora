import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { assertQuota } from "@/server/storage/quota";
import type { SessionUser } from "@/lib/types";

const base: SessionUser = {
  id: "u1",
  username: "marcel",
  displayName: "Marcel",
  email: "m@localhost",
  status: "ACTIVE",
  homePathEnabled: true,
  homePath: "users/marcel",
  quotaBytes: 1000,
  usedBytes: 800,
  canUpload: true,
  canDownload: true,
  canDelete: true,
  canEdit: true,
  canShare: true,
  canOneTimeDownload: true,
  appearance: "dark",
  totpEnabled: false,
  role: { id: "r", name: "Benutzer", slug: "user", permissions: [] },
};

describe("quota", () => {
  it("allows uploads under quota", async () => {
    await expect(assertQuota(base, 100)).resolves.toBeUndefined();
  });

  it("blocks uploads over quota with details", async () => {
    await expect(assertQuota(base, 500)).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      details: { availableBytes: 200, fileBytes: 500 },
    });
    try {
      await assertQuota(base, 2800);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toContain("Speicherlimit");
    }
  });

  it("allows unlimited quota", async () => {
    await expect(assertQuota({ ...base, quotaBytes: null }, 9_000_000_000)).resolves.toBeUndefined();
  });
});
