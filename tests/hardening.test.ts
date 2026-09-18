import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { hashToken, hashWithSecret, tokensEqual } from "@/server/crypto";
import { numberedFileName } from "@/server/storage/names";
import { originIsAllowed } from "@/server/origin";
import { assertZipBudget } from "@/server/services/file-service";
import { shouldRetryUpload, uploadRetryDelayMs } from "@/lib/upload";

describe("session token hashing", () => {
  it("uses HMAC with the session secret", () => {
    const token = "session-token";
    const keyed = hashWithSecret(token, "secret-a");
    expect(keyed).not.toBe(hashToken(token));
    expect(keyed).not.toBe(hashWithSecret(token, "secret-b"));
    expect(tokensEqual(keyed, hashWithSecret(token, "secret-a"))).toBe(true);
  });
});

describe("upload names", () => {
  it("numbers colliding filenames", () => {
    expect(numberedFileName("foto.jpg", 1)).toBe("foto (1).jpg");
    expect(numberedFileName("foto.jpg", 2)).toBe("foto (2).jpg");
    expect(numberedFileName(".env", 1)).toBe(".env (1)");
    expect(numberedFileName("Makefile", 1)).toBe("Makefile (1)");
  });
});

describe("csrf origin", () => {
  const cfg = {
    publicUrl: "http://localhost:3000",
    allowedOrigins: [] as string[],
    host: "localhost:3000",
    proto: "http",
    requireOrigin: true,
  };

  it("rejects missing origin", () => {
    expect(() => originIsAllowed(null, cfg)).toThrow(AppError);
  });

  it("allows same origin", () => {
    expect(() => originIsAllowed("http://localhost:3000", cfg)).not.toThrow();
  });

  it("rejects other origins", () => {
    expect(() => originIsAllowed("https://evil.example", cfg)).toThrow(AppError);
  });
});

describe("upload retry", () => {
  it("retries network and gateway errors", () => {
    expect(shouldRetryUpload(null)).toBe(true);
    expect(shouldRetryUpload(0)).toBe(true);
    expect(shouldRetryUpload(503)).toBe(true);
    expect(shouldRetryUpload(409)).toBe(false);
    expect(shouldRetryUpload(413)).toBe(false);
    expect(uploadRetryDelayMs(0)).toBe(400);
  });
});

describe("zip budget", () => {
  const prevFiles = process.env.MAX_ZIP_FILES;
  const prevBytes = process.env.MAX_ZIP_BYTES;

  afterEach(() => {
    if (prevFiles == null) delete process.env.MAX_ZIP_FILES;
    else process.env.MAX_ZIP_FILES = prevFiles;
    if (prevBytes == null) delete process.env.MAX_ZIP_BYTES;
    else process.env.MAX_ZIP_BYTES = prevBytes;
  });

  it("rejects folders with too many files", async () => {
    process.env.MAX_ZIP_FILES = "1";
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cloudora-zip-"));
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.writeFile(path.join(dir, "b.txt"), "b");
    await expect(assertZipBudget(dir)).rejects.toMatchObject({ code: "ZIP_TOO_MANY_FILES" });
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("public unlock cookie", () => {
  it("accepts a fresh HMAC payload and rejects tampering", async () => {
    const { publicUnlockPayload, publicUnlockValid } = await import("@/server/auth/public-unlock");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const value = publicUnlockPayload("s", "share-token", "secret", exp);
    expect(publicUnlockValid(value, "s", "share-token", "secret")).toBe(true);
    expect(publicUnlockValid(value, "s", "other-token", "secret")).toBe(false);
    expect(publicUnlockValid(value, "d", "share-token", "secret")).toBe(false);
    expect(publicUnlockValid(`${exp}.deadbeef`, "s", "share-token", "secret")).toBe(false);
    expect(publicUnlockValid(publicUnlockPayload("s", "share-token", "secret", exp - 10_000), "s", "share-token", "secret")).toBe(
      false,
    );
  });
});
