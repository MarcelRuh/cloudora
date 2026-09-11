import { z } from "zod";
import { AppError } from "@/lib/errors";
import { authenticateUser, createSession, toSessionUser } from "@/server/auth/session";
import { consumeRateLimitStored } from "@/server/auth/rate-limit";
import { writeAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { assertSameOrigin, clientIp, clientUserAgent, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { ensureUserHome } from "@/server/storage/scope";
import { decryptUserTotpSecret } from "@/server/services/user-service";
import { verifyTotp } from "@/server/auth/totp";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const ip = await clientIp();
    const ua = await clientUserAgent();
    if (!(await consumeRateLimitStored(`login:${ip}`, 8, 15 * 60 * 1000))) {
      throw new AppError("RATE_LIMITED", "Zu viele Anmeldeversuche. Bitte warte einige Minuten.", 429);
    }
    const body = await readJson(request, schema);
    if (!(await consumeRateLimitStored(`login-user:${body.username.toLowerCase()}`, 8, 15 * 60 * 1000))) {
      throw new AppError("RATE_LIMITED", "Zu viele Anmeldeversuche. Bitte warte einige Minuten.", 429);
    }
    try {
      const user = await authenticateUser(body.username, body.password);
      if (user.totpEnabled) {
        if (!body.totp) {
          throw new AppError("TOTP_REQUIRED", "Bitte den 2FA-Code eingeben.", 401);
        }
        if (!user.totpSecret || !verifyTotp(decryptUserTotpSecret(user.totpSecret), body.totp)) {
          throw new AppError("INVALID_TOTP", "Der 2FA-Code ist ungültig.", 401);
        }
      }
      await createSession(user.id, ip, ua);
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const sessionUser = toSessionUser(user);
      ensureUserHome(sessionUser);
      await writeAudit({ userId: user.id, ip, userAgent: ua, action: "LOGIN", target: user.username, result: "SUCCESS" });
      return jsonOk({ user: sessionUser });
    } catch (error) {
      await writeAudit({
        ip,
        userAgent: ua,
        action: "LOGIN_FAILED",
        target: body.username,
        result: "FAILURE",
        error: error instanceof AppError ? error.code : "ERROR",
      });
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
