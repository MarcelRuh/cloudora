import { AppError, isAppError } from "@/lib/errors";
import { assertPublicLinkRateLimit } from "@/server/auth/public-rate-limit";
import { grantPublicUnlock, hasPublicUnlock, type PublicLinkKind } from "@/server/auth/public-unlock";

export async function withPublicUnlock<T>(
  kind: PublicLinkKind,
  token: string,
  run: (unlocked: boolean) => Promise<T>,
): Promise<T> {
  const unlocked = await hasPublicUnlock(kind, token);
  try {
    const result = await run(unlocked);
    await grantPublicUnlock(kind, token);
    return result;
  } catch (error) {
    if (isAppError(error) && error.code === "INVALID_PASSWORD") {
      await assertPublicLinkRateLimit(kind === "s" ? "share" : "otd", token);
    }
    throw error;
  }
}

export function publicFileQuery(relative: string | null): string {
  const value = (relative || "/").trim() || "/";
  if (value.length > 2048) throw new AppError("INVALID_PATH", "Pfad ungültig.", 400);
  return value;
}
