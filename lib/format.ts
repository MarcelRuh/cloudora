const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatBytes(bytes: number | bigint | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const exp = Math.min(Math.floor(Math.log(value) / Math.log(1024)), UNITS.length - 1);
  const num = value / 1024 ** exp;
  return `${num >= 10 || exp === 0 ? num.toFixed(0) : num.toFixed(1)} ${UNITS[exp]}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  const value = Number(bytesPerSecond ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B/s";
  return `${formatBytes(value)}/s`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function greetingForNow(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return "Gute Nacht";
  if (hour < 12) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

export function quotaPercent(used: number, quota: number | null): number | null {
  if (quota == null || quota <= 0) return null;
  return Math.min(100, Math.round((used / quota) * 1000) / 10);
}

export function diskPercent(used: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.round((used / total) * 1000) / 10);
}

export type QuotaUnit = "MB" | "GB";

export function bytesFromQuota(amount: number, unit: QuotaUnit): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * (unit === "GB" ? 1024 ** 3 : 1024 ** 2));
}

export function splitQuotaBytes(bytes: number | null): { amount: string; unit: QuotaUnit } {
  if (bytes == null || bytes <= 0) return { amount: "", unit: "GB" };
  if (bytes >= 1024 ** 3 && bytes % (1024 ** 2) === 0 && bytes / 1024 ** 3 >= 1) {
    const gb = bytes / 1024 ** 3;
    if (Number.isInteger(gb) || gb >= 10) return { amount: String(Number(gb.toFixed(gb >= 10 ? 0 : 1))), unit: "GB" };
    return { amount: String(Number(gb.toFixed(2))), unit: "GB" };
  }
  const mb = bytes / 1024 ** 2;
  return { amount: String(Number(mb.toFixed(mb >= 10 ? 0 : 1))), unit: "MB" };
}
