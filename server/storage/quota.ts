import { AppError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import type { SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { directorySize } from "@/server/storage/fs";
import { extraRootFor, type ResolvedPath } from "@/server/storage/path-resolver";
import { absoluteHomePath } from "@/server/storage/scope";

export function countsTowardQuota(resolved: Pick<ResolvedPath, "scope" | "virtualPath">): boolean {
  return extraRootFor(resolved.scope, resolved.virtualPath)?.kind === "home";
}

export function assertQuotaLimit(usedBytes: number, quotaBytes: number | null, additionalBytes: number): void {
  if (quotaBytes == null) return;
  const next = usedBytes + additionalBytes;
  if (next > quotaBytes) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      "Upload fehlgeschlagen. Die Datei ist größer als dein verfügbares Speicherlimit.",
      413,
      {
        quotaBytes,
        usedBytes,
        availableBytes: Math.max(0, quotaBytes - usedBytes),
        fileBytes: additionalBytes,
        availableLabel: formatBytes(Math.max(0, quotaBytes - usedBytes)),
        fileLabel: formatBytes(additionalBytes),
        quotaLabel: formatBytes(quotaBytes),
      },
    );
  }
}

export async function refreshUsedBytes(userId: string, absHome: string, jailRoot: string): Promise<bigint> {
  const used = await directorySize(absHome, jailRoot);
  await prisma.user.update({ where: { id: userId }, data: { usedBytes: used } });
  return used;
}

export async function assertQuota(user: SessionUser, additionalBytes: number): Promise<void> {
  if (additionalBytes <= 0) return;
  let quota = user.quotaBytes;
  let used = user.usedBytes;
  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { usedBytes: true, quotaBytes: true },
    });
    if (row) {
      used = Number(row.usedBytes);
      quota = row.quotaBytes == null ? null : Number(row.quotaBytes);
    }
  } catch {
    /* Session-Werte als Fallback, wenn die DB gerade nicht lesbar ist */
  }
  assertQuotaLimit(used, quota, additionalBytes);
}

export async function bumpUsedBytes(userId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: { usedBytes: { increment: BigInt(delta) } },
  });
}

export async function recomputeUserQuota(user: SessionUser): Promise<number> {
  const home = absoluteHomePath(user);
  const homeUsed = user.homePathEnabled ? await directorySize(home, home) : BigInt(0);
  const { trashBytesForUser } = await import("@/server/services/trash-service");
  const trashUsed = await trashBytesForUser(user.id);
  const used = homeUsed + trashUsed;
  await prisma.user.update({ where: { id: user.id }, data: { usedBytes: used } });
  return Number(used);
}
