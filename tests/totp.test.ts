import { describe, expect, it } from "vitest";
import { generateTotpSecret, otpauthUrl, totpCode, verifyTotp } from "@/server/auth/totp";
import { decryptString, encryptString } from "@/server/crypto";

describe("totp", () => {
  it("generates a base32 secret and verifies the current code", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    const code = totpCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(false);
  });

  it("accepts adjacent time steps", () => {
    const secret = generateTotpSecret();
    const previous = totpCode(secret, Date.now() - 30_000);
    expect(verifyTotp(secret, previous)).toBe(true);
  });

  it("builds an otpauth URL", () => {
    expect(otpauthUrl("admin", "SECRET")).toContain("otpauth://totp/Cloudora%3Aadmin");
    expect(otpauthUrl("admin", "SECRET")).toContain("secret=SECRET");
  });
});

describe("crypto envelope", () => {
  it("roundtrips encrypted strings", () => {
    const secret = "x".repeat(32);
    const payload = encryptString("totp-secret", secret);
    expect(payload).not.toContain("totp-secret");
    expect(decryptString(payload, secret)).toBe("totp-secret");
  });
});
