import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

export function jsonOk<T extends object>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(error: unknown): NextResponse {
  if (isAppError(error)) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details ?? undefined },
      { status: error.status },
    );
  }
  logger.error({ err: error }, "unhandled api error");
  return NextResponse.json({ error: "Ein unerwarteter Fehler ist aufgetreten.", code: "INTERNAL" }, { status: 500 });
}

export async function clientIp(): Promise<string> {
  const env = getEnv();
  const h = await headers();
  if (env.trustProxy) {
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return h.get("x-real-ip") || "unknown";
}

export async function clientUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const referer = h.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function publicOrigin(): string {
  return getEnv().publicUrl;
}

export async function assertSameOrigin(): Promise<void> {
  const origin = await requestOrigin();
  if (!origin) return;
  const env = getEnv();
  const allowed = new Set<string>([env.publicUrl, ...env.allowedOrigins]);
  try {
    allowed.add(new URL(env.publicUrl).origin);
  } catch {
    /* ignore */
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = env.trustProxy ? (h.get("x-forwarded-proto") ?? "http") : "http";
  if (host) allowed.add(`${proto}://${host.split(",")[0]?.trim()}`);
  if (!env.trustProxy && host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  const originUrl = origin.replace(/\/$/, "");
  if (![...allowed].some((item) => item.replace(/\/$/, "") === originUrl)) {
    throw new AppError("CSRF", "Ungültige Herkunft der Anfrage.", 403);
  }
}

export const COOKIE_NAME = "cloudora_session";

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const env = getEnv();
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().cookieSecure,
    path: "/",
    expires: new Date(0),
  });
}
