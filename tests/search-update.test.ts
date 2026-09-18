import { describe, expect, it } from "vitest";
import { fileIndexKey, fileIndexVisibleFilter, isTrashIndexPath, parseFileIndexKey } from "@/server/storage/file-index";
import {
  resolveSelfUpdateMode,
  selfUpdateReadyMessage,
  selfUpdateUnavailableMessage,
} from "@/server/services/self-update-mode";

describe("file index keys", () => {
  it("encodes and parses scope plus virtual path", () => {
    const key = fileIndexKey("global", "/Home/foto.jpg");
    expect(key).toBe("global:/Home/foto.jpg");
    expect(parseFileIndexKey(key)).toEqual({ scopeKind: "global", virtualPath: "/Home/foto.jpg" });
    expect(parseFileIndexKey("nocolon")).toBeNull();
  });

  it("scopes visibility to extra roots", () => {
    const filter = fileIndexVisibleFilter("global", ["/Home", "/freigabe1"]);
    expect(filter).toEqual([
      { virtualPath: "global:/Home" },
      { virtualPath: { startsWith: "global:/Home/" } },
      { virtualPath: "global:/freigabe1" },
      { virtualPath: { startsWith: "global:/freigabe1/" } },
    ]);
  });

  it("detects trash paths", () => {
    expect(isTrashIndexPath("/.trash")).toBe(true);
    expect(isTrashIndexPath("/Home/.trash/a")).toBe(true);
    expect(isTrashIndexPath("/Home/foto.jpg")).toBe(false);
  });
});

describe("self-update mode", () => {
  it("is native when enabled", () => {
    expect(resolveSelfUpdateMode(true)).toBe("native");
    expect(resolveSelfUpdateMode(false)).toBe("none");
  });

  it("points to the install dir when unavailable", () => {
    expect(selfUpdateUnavailableMessage()).toContain("CLOUDORA_INSTALL_DIR");
    expect(selfUpdateUnavailableMessage()).not.toContain("Compose");
    expect(selfUpdateUnavailableMessage()).not.toContain("docker");
  });

  it("formats ready status", () => {
    expect(
      selfUpdateReadyMessage({
        updating: false,
        updateAvailable: true,
        currentVersion: "1.3.7",
        targetVersion: "1.3.8",
        shaError: null,
      }),
    ).toBe("Update verfügbar — 1.3.7 → 1.3.8");
    expect(
      selfUpdateReadyMessage({
        updating: false,
        updateAvailable: false,
        currentVersion: "1.3.8",
        targetVersion: null,
        shaError: null,
      }),
    ).toBe("Aktuell");
  });
});
