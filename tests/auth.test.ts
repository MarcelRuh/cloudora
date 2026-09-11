import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct-horse");
    expect(hash).not.toContain("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
