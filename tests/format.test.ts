import { describe, expect, it } from "vitest";
import { bytesFromQuota, splitQuotaBytes } from "@/lib/format";

describe("quota units", () => {
  it("converts GB and MB to bytes", () => {
    expect(bytesFromQuota(1, "GB")).toBe(1024 ** 3);
    expect(bytesFromQuota(500, "MB")).toBe(500 * 1024 ** 2);
    expect(bytesFromQuota(-1, "GB")).toBe(0);
  });

  it("splits stored bytes back into a friendly unit", () => {
    expect(splitQuotaBytes(null)).toEqual({ amount: "", unit: "GB" });
    expect(splitQuotaBytes(1024 ** 3)).toEqual({ amount: "1", unit: "GB" });
    expect(splitQuotaBytes(500 * 1024 ** 2)).toEqual({ amount: "500", unit: "MB" });
  });
});
