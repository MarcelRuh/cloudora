import { prisma } from "@/server/db";

const memory = new Map<string, { count: number; resetAt: number }>();

export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = memory.get(key);
  if (!current || current.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function remainingMs(key: string): number {
  const current = memory.get(key);
  if (!current) return 0;
  return Math.max(0, current.resetAt - Date.now());
}

/** Durable login throttle (survives restarts). Falls back to memory if the DB is unavailable. */
export async function consumeRateLimitStored(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  try {
    const row = await prisma.rateLimit.findUnique({ where: { key } });
    if (!row || row.resetAt <= now) {
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, resetAt: new Date(now.getTime() + windowMs) },
        update: { count: 1, resetAt: new Date(now.getTime() + windowMs) },
      });
      if (Math.random() < 0.05) {
        await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } }).catch(() => undefined);
      }
      return true;
    }
    if (row.count >= limit) return false;
    await prisma.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  } catch {
    return consumeRateLimit(key, limit, windowMs);
  }
}
