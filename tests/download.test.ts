import { describe, expect, it } from "vitest";
import {
  BLOB_FALLBACK_MAX_BYTES,
  downloadErrorMessage,
  errorFromResponse,
  isAbortError,
  shouldOfferSavePicker,
  shouldUseNativeBrowserDownload,
} from "@/lib/download";
import { isByteRangeResume, streamBodyHeaders } from "@/server/storage/http-file";

describe("download client helpers", () => {
  it("detects abort errors", () => {
    const abort = new Error("The user aborted a request.");
    abort.name = "AbortError";
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error("fail"))).toBe(false);
    expect(downloadErrorMessage(abort)).toBe("Download abgebrochen");
    expect(downloadErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Verbindung unterbrochen. Bitte erneut versuchen.",
    );
  });

  it("streams large files and zips via the browser when no save handle exists", () => {
    expect(shouldOfferSavePicker(true, null)).toBe(true);
    expect(shouldOfferSavePicker(false, 1024)).toBe(false);
    expect(shouldOfferSavePicker(false, BLOB_FALLBACK_MAX_BYTES + 1)).toBe(true);
    expect(
      shouldUseNativeBrowserDownload({ hasSaveHandle: true, isArchive: true, knownSize: null }),
    ).toBe(false);
    expect(
      shouldUseNativeBrowserDownload({
        hasSaveHandle: false,
        isArchive: false,
        knownSize: BLOB_FALLBACK_MAX_BYTES + 1,
      }),
    ).toBe(true);
  });

  it("reads JSON error bodies from failed responses", async () => {
    const res = new Response(JSON.stringify({ error: "Kein Zugriff" }), { status: 403 });
    expect(await errorFromResponse(res)).toBe("Kein Zugriff");
    expect(await errorFromResponse(new Response("", { status: 500 }))).toBe("Download fehlgeschlagen (500)");
  });
});

describe("download stream headers", () => {
  it("disables compression so Content-Length stays valid", () => {
    const headers = streamBodyHeaders({
      mime: "application/octet-stream",
      fileName: "win.iso",
      disposition: "attachment",
      size: 8_000_000_000,
    });
    expect(headers["Content-Encoding"]).toBe("identity");
    expect(headers["Content-Length"]).toBe("8000000000");
    expect(headers["X-Accel-Buffering"]).toBe("no");
    expect(headers["Content-Disposition"]).toContain("win.iso");
  });

  it("treats mid-file Range as resume", () => {
    expect(isByteRangeResume(new Request("http://x", { headers: { range: "bytes=0-99" } }))).toBe(false);
    expect(isByteRangeResume(new Request("http://x", { headers: { range: "bytes=500000000-" } }))).toBe(true);
    expect(isByteRangeResume(new Request("http://x"))).toBe(false);
  });
});
