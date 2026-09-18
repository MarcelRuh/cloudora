import {
  BLOB_FALLBACK_MAX_BYTES,
  errorFromResponse,
  shouldUseNativeBrowserDownload,
} from "@/lib/download";
import { filenameFromDisposition } from "@/lib/transfer";

export type SaveFileHandle = {
  createWritable: () => Promise<SaveWritable>;
};

type SaveWritable = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};

export type DownloadResult = {
  filename: string;
  loaded: number;
  total: number | null;
  mode: "stream" | "blob" | "browser";
};

function startObjectUrlDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
}

export function startNativeDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  // Content-Disposition sets the name. The download attribute makes Chrome
  // buffer instead of using the resumable download manager.
  if (!url.startsWith("/api/") && !/^https?:\/\//i.test(url)) {
    link.download = filename;
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function requestSaveHandle(suggestedName: string): Promise<SaveFileHandle | null> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: { suggestedName?: string }) => Promise<SaveFileHandle>;
    }
  ).showSaveFilePicker;
  if (typeof picker !== "function") return null;
  return picker({ suggestedName });
}

async function pumpStream(
  body: ReadableStream<Uint8Array>,
  write: (chunk: Uint8Array) => Promise<void>,
  onProgress: (loaded: number) => void,
): Promise<number> {
  const reader = body.getReader();
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      loaded += value.byteLength;
      await write(value);
      onProgress(loaded);
    }
    return loaded;
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
}

export async function saveResponseWithProgress(opts: {
  response: Response;
  filename: string;
  knownSize?: number | null;
  handle?: SaveFileHandle | null;
  onProgress?: (loaded: number, total: number | null) => void;
}): Promise<DownloadResult> {
  const res = opts.response;
  if (!res.ok) throw new Error(await errorFromResponse(res));
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), opts.filename);
  const headerLen = Number(res.headers.get("Content-Length"));
  const total =
    Number.isFinite(headerLen) && headerLen > 0
      ? headerLen
      : opts.knownSize && opts.knownSize > 0
        ? opts.knownSize
        : null;
  const body = res.body;
  if (!body) throw new Error("Leere Antwort vom Server.");
  const onProgress = opts.onProgress ?? (() => undefined);

  if (opts.handle) {
    const writable = await opts.handle.createWritable();
    try {
      const loaded = await pumpStream(body, (chunk) => writable.write(chunk), (n) => onProgress(n, total));
      await writable.close();
      onProgress(loaded, total ?? loaded);
      return { filename, loaded, total: total ?? loaded, mode: "stream" };
    } catch (err) {
      await writable.abort().catch(() => undefined);
      throw err;
    }
  }

  if (total && total > BLOB_FALLBACK_MAX_BYTES) {
    await body.cancel().catch(() => undefined);
    throw new Error("Datei ist zu groß für den Speicher-Download in diesem Browser.");
  }

  const chunks: Uint8Array[] = [];
  const loaded = await pumpStream(
    body,
    async (chunk) => {
      chunks.push(chunk);
    },
    (n) => onProgress(n, total),
  );
  startObjectUrlDownload(new Blob(chunks as unknown as BlobPart[]), filename);
  onProgress(loaded, total ?? loaded);
  return { filename, loaded, total: total ?? loaded, mode: "blob" };
}

export async function downloadGetWithProgress(opts: {
  url: string;
  filename: string;
  knownSize?: number | null;
  isArchive?: boolean;
  handle?: SaveFileHandle | null;
  onProgress?: (loaded: number, total: number | null) => void;
}): Promise<DownloadResult> {
  const knownSize = opts.knownSize && opts.knownSize > 0 ? opts.knownSize : null;
  if (
    shouldUseNativeBrowserDownload({
      hasSaveHandle: Boolean(opts.handle),
      isArchive: Boolean(opts.isArchive),
      knownSize,
    })
  ) {
    startNativeDownload(opts.url, opts.filename);
    opts.onProgress?.(knownSize ?? 0, knownSize);
    return { filename: opts.filename, loaded: knownSize ?? 0, total: knownSize, mode: "browser" };
  }

  const res = await fetch(opts.url, { credentials: "same-origin", cache: "no-store" });
  return saveResponseWithProgress({
    response: res,
    filename: opts.filename,
    knownSize,
    handle: opts.handle,
    onProgress: opts.onProgress,
  });
}
