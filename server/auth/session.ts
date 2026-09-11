import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
import { sanitizePermissions, type Permission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { COOKIE_NAME, clearSessionCookie, setSessionCookie } from "@/server/http";
import { hashToken, randomToken } from "@/server/crypto";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { hydrateStoragePaths } from "@/server/storage/config";

function toNumber(value: bigint | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

export function toSessionUser(user: {
  id: string;
  username: string;
  displayName: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  homePathEnabled: boolean;
  homePath: string;
  quotaBytes: bigint | null;
  usedBytes: bigint;
  canUpload: boolean;
  canDownload: boolean;
  canDelete: boolean;
  canEdit: boolean;
  canShare: boolean;
  canOneTimeDownload: boolean;
  appearance: string;
  totpEnabled: boolean;
  role: { id: string; name: string; slug: string; permissions: string[] };
}): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    status: user.status,
    homePathEnabled: user.homePathEnabled,
    homePath: user.homePath,
    quotaBytes: user.quotaBytes == null ? null : toNumber(user.quotaBytes),
    usedBytes: toNumber(user.usedBytes),
    canUpload: user.canUpload,
    canDownload: user.canDownload,
    canDelete: user.canDelete,
    canEdit: user.canEdit,
    canShare: user.canShare,
    canOneTimeDownload: user.canOneTimeDownload,
    appearance: user.appearance,
    totpEnabled: user.totpEnabled,
    role: {
      id: user.role.id,
      name: user.role.name,
      slug: user.role.slug,
      permissions: sanitizePermissions(user.role.permissions) as Permission[],
    },
  };
}

const userInclude = { role: true } as const;

export async function createSession(userId: string, ip: string | null, userAgent: string | null): Promise<string> {
  const env = getEnv();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.sessionDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ip,
      userAgent,
      expiresAt,
    },
  });
  await setSessionCookie(token, expiresAt);
  return token;
}

export async function destroySession(): Promise<void> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  await clearSessionCookie();
}

export async function getSession(): Promise<SessionUser | null> {
  await hydrateStoragePaths();
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: userInclude } },
  });
  if (!row || row.expiresAt < new Date()) {
    if (row) await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  if (row.user.status !== "ACTIVE") return null;
  return toSessionUser(row.user);
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHENTICATED", "Bitte anmelden.", 401);
  return session;
}

export async function authenticateUser(identifier: string, password: string) {
  const normalized = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: { equals: normalized, mode: "insensitive" } }, { email: { equals: normalized, mode: "insensitive" } }],
    },
    include: userInclude,
  });
  if (!user) {
    await hashPassword(password);
    throw new AppError("INVALID_CREDENTIALS", "Benutzername oder Passwort ist falsch.", 401);
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new AppError("INVALID_CREDENTIALS", "Benutzername oder Passwort ist falsch.", 401);
  if (user.status !== "ACTIVE") {
    throw new AppError("ACCOUNT_DISABLED", "Dieses Konto ist deaktiviert.", 403);
  }
  return user;
}
