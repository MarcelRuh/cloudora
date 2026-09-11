import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { logger } from "@/server/logger";

export async function writeAudit(input: {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  action: string;
  target?: string | null;
  result?: "SUCCESS" | "FAILURE";
  error?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        action: input.action,
        target: input.target ?? null,
        result: input.result ?? "SUCCESS",
        error: input.error ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action }, "audit write failed");
  }
}
