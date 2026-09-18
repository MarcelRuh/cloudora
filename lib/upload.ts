export function shouldRetryUpload(status: number | null): boolean {
  if (status == null || status === 0) return true;
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

export function uploadRetryDelayMs(attempt: number): number {
  return Math.min(4_000, 400 * 2 ** attempt);
}

export const UPLOAD_MAX_ATTEMPTS = 3;
