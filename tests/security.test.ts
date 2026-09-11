import { describe, expect, it } from "vitest";
import { hashToken, randomToken, tokensEqual } from "@/server/crypto";
import { consumeRateLimit } from "@/server/auth/rate-limit";

describe("one-time tokens", () => {
  it("creates non-sequential high-entropy tokens", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/^[0-9]+$/);
    expect(a.includes("/")).toBe(false);
    expect(hashToken(a)).not.toBe(a);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(tokensEqual(hashToken(a), hashToken(a))).toBe(true);
  });
});

describe("login rate limit", () => {
  it("blocks after the limit", () => {
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 3; i++) expect(consumeRateLimit(key, 3, 60_000)).toBe(true);
    expect(consumeRateLimit(key, 3, 60_000)).toBe(false);
  });
});
