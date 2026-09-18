import { consumeRateLimitStored } from "@/server/auth/rate-limit";
import { hashToken } from "@/server/crypto";
import { AppError } from "@/lib/errors";
import { clientIp } from "@/server/http";

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP = 40;
const PER_TOKEN_IP = 8;

export async function assertPublicLinkRateLimit(kind: "share" | "otd", token: string): Promise<void> {
  const ip = await clientIp();
  const tokenPart = hashToken(token).slice(0, 16);
  const okIp = await consumeRateLimitStored(`pubfail:${kind}:ip:${ip}`, PER_IP, WINDOW_MS);
  const okPair = await consumeRateLimitStored(`pubfail:${kind}:tok:${tokenPart}:${ip}`, PER_TOKEN_IP, WINDOW_MS);
  if (!okIp || !okPair) {
    throw new AppError("RATE_LIMITED", "Zu viele Versuche. Bitte warte einige Minuten.", 429);
  }
}
