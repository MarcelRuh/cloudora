import { AppError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import type { SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { directorySize } from "@/server/storage/fs";
import { absoluteHomePath } from "@/server/storage/scope";

export async function refreshUsedBytes(userId: string, absHome: string, jailRoot: string): Promise<bigint> {
  const used = await directorySize(absHome, jailRoot);
  await prisma.user.update({ where: { id: userId }, data: { usedBytes: used } });
  return used;
}

export async function assertQuota(user: SessionUser, additionalBytes: number): Promise<void> {
  if (user.quotaBytes == null) return;
  const used = user.usedBytes;
  const next = used + additionalBytes;
  if (next > user.quotaBytes) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      "Upload fehlgeschlagen. Die Datei ist größer als dein verfügbares Speicherlimit.",
      413,
      {
        quotaBytes: user.quotaBytes,
        usedBytes: used,
        availableBytes: Math.max(0, user.quotaBytes - used),
        fileBytes: additionalBytes,
        availableLabel: formatBytes(Math.max(0, user.quotaBytes - used)),
        fileLabel: formatBytes(additionalBytes),
        quotaLabel: formatBytes(user.quotaBytes),
      },
    );
  }
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
  const homeUsed = await refreshUsedBytes(user.id, home, home);
  const { trashBytesForUser } = await import("@/server/services/trash-service");
  const trashUsed = await trashBytesForUser(user.id);
  const used = homeUsed + trashUsed;
  await prisma.user.update({ where: { id: user.id }, data: { usedBytes: used } });
  return Number(used);
}
