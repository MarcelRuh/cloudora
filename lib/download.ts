export const BLOB_FALLBACK_MAX_BYTES = 512 * 1024 * 1024;

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function shouldOfferSavePicker(isArchive: boolean, knownSize: number | null): boolean {
  return isArchive || (knownSize != null && knownSize > BLOB_FALLBACK_MAX_BYTES);
}

export function shouldUseNativeBrowserDownload(opts: {
  hasSaveHandle: boolean;
  isArchive: boolean;
  knownSize: number | null;
}): boolean {
  if (opts.hasSaveHandle) return false;
  return shouldOfferSavePicker(opts.isArchive, opts.knownSize);
}

export async function errorFromResponse(res: Response, fallback = "Download fehlgeschlagen"): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `${fallback} (${res.status})`;
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error?.trim() || `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

export function downloadErrorMessage(err: unknown): string {
  if (isAbortError(err)) return "Download abgebrochen";
  if (err instanceof TypeError) return "Verbindung unterbrochen. Bitte erneut versuchen.";
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Download fehlgeschlagen";
}
