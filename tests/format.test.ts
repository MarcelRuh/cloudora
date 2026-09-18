import { describe, expect, it } from "vitest";
import { bytesFromQuota, formatSpeed, splitQuotaBytes } from "@/lib/format";
import { filenameFromDisposition, transferProgress } from "@/lib/transfer";

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

describe("transfer display", () => {
  it("formats speed", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
    expect(formatSpeed(1024 * 1024)).toBe("1.0 MB/s");
  });

  it("computes percent and parses Content-Disposition", () => {
    expect(transferProgress(25, 100)).toBe(25);
    expect(transferProgress(10, null)).toBe(0);
    expect(filenameFromDisposition(`attachment; filename="foto.jpg"; filename*=UTF-8''foto.jpg`, "x")).toBe("foto.jpg");
    expect(filenameFromDisposition(null, "fallback.bin")).toBe("fallback.bin");
  });
});
