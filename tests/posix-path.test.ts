import { describe, expect, it } from "vitest";
import {
  isInsideStorageRoot,
  joinPosix,
  suggestUserHome,
  toConfiguredFromAbsolute,
} from "@/lib/posix-path";

describe("posix path helpers", () => {
  it("detects volume membership", () => {
    expect(isInsideStorageRoot("/storage", "/storage")).toBe(true);
    expect(isInsideStorageRoot("/storage/users/anna", "/storage")).toBe(true);
    expect(isInsideStorageRoot("/home/anna", "/storage")).toBe(false);
    expect(isInsideStorageRoot("/", "/storage")).toBe(false);
  });

  it("stores relative paths under the volume", () => {
    expect(toConfiguredFromAbsolute("/storage/users/anna", "/storage", true)).toBe("users/anna");
    expect(toConfiguredFromAbsolute("/storage", "/storage", true)).toBe("/storage");
    expect(toConfiguredFromAbsolute("/home/anna", "/storage", true)).toBe("/home/anna");
    expect(toConfiguredFromAbsolute("/storage/users", "/storage", false)).toBe("/storage/users");
  });

  it("suggests homes from users dir", () => {
    expect(suggestUserHome("users", "Anna")).toBe("users/anna");
    expect(suggestUserHome("/home", "anna")).toBe("/home/anna");
    expect(joinPosix("users", "anna")).toBe("users/anna");
  });
});
