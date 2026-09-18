export type TransferKind = "upload" | "download";

export type TransferItem = {
  id: string;
  name: string;
  kind: TransferKind;
  loaded: number;
  total: number | null;
  progress: number;
  speedBps: number;
  error?: string;
  done?: boolean;
};

export function createSpeedTracker() {
  let lastLoaded = 0;
  let lastAt = 0;
  let ema = 0;
  return (loaded: number): number => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!lastAt) {
      lastLoaded = loaded;
      lastAt = now;
      return 0;
    }
    const dt = (now - lastAt) / 1000;
    if (dt < 0.12) return ema;
    const inst = Math.max(0, (loaded - lastLoaded) / dt);
    ema = ema === 0 ? inst : ema * 0.65 + inst * 0.35;
    lastLoaded = loaded;
    lastAt = now;
    return ema;
  };
}

export function transferProgress(loaded: number, total: number | null): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}

export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"(.*)"$/, "$1"));
    } catch {
      /* keep fallback parse */
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

export function newTransferId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
