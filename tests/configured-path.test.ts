import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  isAbsolutePosixPath,
  joinConfigured,
  normalizeConfiguredPath,
  resolveConfiguredPath,
} from "@/server/storage/configured-path";

describe("normalizeConfiguredPath", () => {
  it("keeps absolute homes like /home", () => {
    expect(normalizeConfiguredPath("/home")).toBe("/home");
    expect(normalizeConfiguredPath("/home/")).toBe("/home");
    expect(normalizeConfiguredPath("/home/anna")).toBe("/home/anna");
  });

  it("keeps relative homes under the storage root", () => {
    expect(normalizeConfiguredPath("users/anna")).toBe("users/anna");
    expect(normalizeConfiguredPath("/users/anna", "x")).toBe("/users/anna");
  });

  it("rejects traversal and root", () => {
    expect(() => normalizeConfiguredPath("/")).toThrow(AppError);
    expect(() => normalizeConfiguredPath("/home/../etc")).toThrow(AppError);
    expect(() => normalizeConfiguredPath("users/../etc")).toThrow(AppError);
    expect(() => normalizeConfiguredPath("~anna")).toThrow(AppError);
  });

  it("joins default homes", () => {
    expect(joinConfigured("users", "anna")).toBe("users/anna");
    expect(joinConfigured("/home", "anna")).toBe("/home/anna");
  });

  it("resolves against storage root only when relative", () => {
    expect(resolveConfiguredPath("/home", "/storage")).toBe("/home");
    expect(isAbsolutePosixPath("/home")).toBe(true);
    expect(resolveConfiguredPath("users/anna", "/storage")).toBe("/storage/users/anna");
  });
});
