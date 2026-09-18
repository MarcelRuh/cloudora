import { cookies } from "next/headers";
import { hashToken, hashWithSecret, tokensEqual } from "@/server/crypto";
import { getEnv } from "@/server/env";

export type PublicLinkKind = "s" | "d";

const TTL_SEC = 8 * 60 * 60;

function cookieName(kind: PublicLinkKind, token: string): string {
  return `cloudora_pub_${kind}_${hashToken(token).slice(0, 16)}`;
}

export function publicUnlockPayload(kind: PublicLinkKind, token: string, secret: string, exp: number): string {
  const mac = hashWithSecret(`${kind}:${hashToken(token)}:${exp}`, secret);
  return `${exp}.${mac}`;
}

export function publicUnlockValid(
  value: string | undefined,
  kind: PublicLinkKind,
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(value.slice(0, dot));
  const mac = value.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < nowSec || !mac) return false;
  const expected = hashWithSecret(`${kind}:${hashToken(token)}:${exp}`, secret);
  return tokensEqual(mac, expected);
}

export async function hasPublicUnlock(kind: PublicLinkKind, token: string): Promise<boolean> {
  const jar = await cookies();
  const env = getEnv();
  return publicUnlockValid(jar.get(cookieName(kind, token))?.value, kind, token, env.sessionSecret);
}

export async function grantPublicUnlock(kind: PublicLinkKind, token: string): Promise<void> {
  const env = getEnv();
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  (await cookies()).set(cookieName(kind, token), publicUnlockPayload(kind, token, env.sessionSecret, exp), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
    expires: new Date(exp * 1000),
  });
}
