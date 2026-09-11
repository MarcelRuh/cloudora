import { AppError } from "@/lib/errors";
import { ALL_PERMISSIONS, sanitizePermissions, USER_PERMISSIONS, type Permission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/server/auth/totp";
import { encryptString, decryptString } from "@/server/crypto";
import { getEnv } from "@/server/env";
import { toSessionUser } from "@/server/auth/session";
import { ensureUserHome, sanitizeHomeRelPath, defaultHomePath, validateConfiguredHomePath } from "@/server/storage/scope";
import { recomputeUserQuota } from "@/server/storage/quota";

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    include: { role: true },
    orderBy: { username: "asc" },
  });
  return users.map(toSessionUser);
}

export async function getUserById(id: string): Promise<SessionUser> {
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new AppError("NOT_FOUND", "Benutzer nicht gefunden.", 404);
  return toSessionUser(user);
}

type UserInput = {
  username: string;
  displayName: string;
  email: string;
  password?: string;
  status?: "ACTIVE" | "DISABLED";
  roleSlug?: string;
  homePathEnabled?: boolean;
  homePath?: string;
  quotaBytes?: number | null;
  canUpload?: boolean;
  canDownload?: boolean;
  canDelete?: boolean;
  canEdit?: boolean;
  canShare?: boolean;
  canOneTimeDownload?: boolean;
};

function validateIdentity(input: Pick<UserInput, "username" | "email" | "displayName">) {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  if (!USERNAME_RE.test(username)) {
    throw new AppError("VALIDATION_ERROR", "Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, . _ -", 400);
  }
  if (!EMAIL_RE.test(email)) {
    throw new AppError("VALIDATION_ERROR", "Ungültige E-Mail-Adresse.", 400);
  }
  if (displayName.length < 1 || displayName.length > 80) {
    throw new AppError("VALIDATION_ERROR", "Anzeigename fehlt oder ist zu lang.", 400);
  }
  return { username, email, displayName };
}

export async function createUser(input: UserInput): Promise<SessionUser> {
  const { username, email, displayName } = validateIdentity(input);
  if (!input.password || input.password.length < 8) {
    throw new AppError("VALIDATION_ERROR", "Passwort muss mindestens 8 Zeichen haben.", 400);
  }
  const role = await prisma.role.findUnique({
    where: { slug: input.roleSlug === "administrator" ? "administrator" : "user" },
  });
  if (!role) throw new AppError("NOT_FOUND", "Rolle nicht gefunden.", 404);
  const homePath = sanitizeHomeRelPath(input.homePath || defaultHomePath(username), username);
  const user = await prisma.user.create({
    data: {
      username,
      email,
      displayName,
      passwordHash: await hashPassword(input.password),
      status: input.status ?? "ACTIVE",
      roleId: role.id,
      homePathEnabled: input.homePathEnabled ?? true,
      homePath,
      quotaBytes: input.quotaBytes == null ? null : BigInt(input.quotaBytes),
      canUpload: input.canUpload ?? true,
      canDownload: input.canDownload ?? true,
      canDelete: input.canDelete ?? true,
      canEdit: input.canEdit ?? true,
      canShare: input.canShare ?? true,
      canOneTimeDownload: input.canOneTimeDownload ?? true,
    },
    include: { role: true },
  });
  const sessionUser = toSessionUser(user);
  ensureUserHome(sessionUser);
  return sessionUser;
}

export async function updateUser(id: string, input: Partial<UserInput>, actor: SessionUser): Promise<SessionUser> {
  const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Benutzer nicht gefunden.", 404);
  if (existing.role.slug === "administrator" && actor.id === id && input.status === "DISABLED") {
    throw new AppError("FORBIDDEN", "Du kannst dich nicht selbst deaktivieren.", 400);
  }
  const data: Record<string, unknown> = {};
  if (input.username || input.email || input.displayName) {
    const ident = validateIdentity({
      username: input.username ?? existing.username,
      email: input.email ?? existing.email,
      displayName: input.displayName ?? existing.displayName,
    });
    data.username = ident.username;
    data.email = ident.email;
    data.displayName = ident.displayName;
  }
  if (input.password) {
    if (input.password.length < 8) {
      throw new AppError("VALIDATION_ERROR", "Passwort muss mindestens 8 Zeichen haben.", 400);
    }
    data.passwordHash = await hashPassword(input.password);
  }
  if (input.status) data.status = input.status;
  if (input.roleSlug) {
    const role = await prisma.role.findUnique({ where: { slug: input.roleSlug } });
    if (!role) throw new AppError("NOT_FOUND", "Rolle nicht gefunden.", 404);
    data.roleId = role.id;
  }
  if (input.homePathEnabled != null) data.homePathEnabled = input.homePathEnabled;
  if (input.homePath != null) {
    data.homePath = validateConfiguredHomePath(input.homePath, existing.username);
  }
  if (input.quotaBytes !== undefined) {
    data.quotaBytes = input.quotaBytes == null ? null : BigInt(input.quotaBytes);
  }
  for (const flag of [
    "canUpload",
    "canDownload",
    "canDelete",
    "canEdit",
    "canShare",
    "canOneTimeDownload",
  ] as const) {
    if (input[flag] != null) data[flag] = input[flag];
  }
  const user = await prisma.user.update({ where: { id }, data, include: { role: true } });
  const sessionUser = toSessionUser(user);
  ensureUserHome(sessionUser);
  return sessionUser;
}

export async function deleteUser(id: string, actorId: string): Promise<void> {
  if (id === actorId) throw new AppError("FORBIDDEN", "Du kannst dich nicht selbst löschen.", 400);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError("NOT_FOUND", "Benutzer nicht gefunden.", 404);
  await prisma.session.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } });
}

export async function changeOwnPassword(userId: string, current: string, next: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND", "Benutzer nicht gefunden.", 404);
  const { verifyPassword } = await import("@/server/auth/password");
  const ok = await verifyPassword(current, user.passwordHash);
  if (!ok) throw new AppError("INVALID_CREDENTIALS", "Aktuelles Passwort ist falsch.", 400);
  if (next.length < 8) throw new AppError("VALIDATION_ERROR", "Passwort muss mindestens 8 Zeichen haben.", 400);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
}

export async function updateOwnProfile(userId: string, input: { displayName?: string; appearance?: string }) {
  const data: Record<string, unknown> = {};
  if (input.displayName) data.displayName = input.displayName.trim();
  if (input.appearance === "dark" || input.appearance === "light") data.appearance = input.appearance;
  const user = await prisma.user.update({ where: { id: userId }, data, include: { role: true } });
  return toSessionUser(user);
}

export async function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" } });
}

export async function updateRolePermissions(roleId: string, permissions: string[]) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new AppError("NOT_FOUND", "Rolle nicht gefunden.", 404);
  if (role.slug === "administrator") {
    return prisma.role.update({
      where: { id: roleId },
      data: { permissions: ALL_PERMISSIONS as unknown as string[] },
    });
  }
  return prisma.role.update({
    where: { id: roleId },
    data: { permissions: sanitizePermissions(permissions) },
  });
}

export async function refreshQuota(user: SessionUser) {
  const used = await recomputeUserQuota(user);
  return { usedBytes: used, quotaBytes: user.quotaBytes };
}

export async function beginTotpSetup(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND", "Benutzer nicht gefunden.", 404);
  if (user.totpEnabled) throw new AppError("ALREADY_EXISTS", "2FA ist bereits aktiv.", 409);
  const { verifyPassword } = await import("@/server/auth/password");
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", "Aktuelles Passwort ist falsch.", 400);
  }
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptString(secret, getEnv().encryptionKey), totpEnabled: false },
  });
  return { secret, otpauthUrl: otpauthUrl(user.username, secret) };
}

export async function confirmTotpSetup(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecret) throw new AppError("NOT_FOUND", "2FA-Einrichtung nicht gestartet.", 404);
  if (user.totpEnabled) throw new AppError("ALREADY_EXISTS", "2FA ist bereits aktiv.", 409);
  const secret = decryptString(user.totpSecret, getEnv().encryptionKey);
  if (!verifyTotp(secret, code)) throw new AppError("INVALID_TOTP", "Der Code ist ungültig.", 400);
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
}

export async function disableTotp(userId: string, password: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND", "Benutzer nicht gefunden.", 404);
  if (!user.totpEnabled || !user.totpSecret) throw new AppError("NOT_FOUND", "2FA ist nicht aktiv.", 400);
  const { verifyPassword } = await import("@/server/auth/password");
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", "Aktuelles Passwort ist falsch.", 400);
  }
  const secret = decryptString(user.totpSecret, getEnv().encryptionKey);
  if (!verifyTotp(secret, code)) throw new AppError("INVALID_TOTP", "Der Code ist ungültig.", 400);
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null } });
}

export function decryptUserTotpSecret(encrypted: string): string {
  return decryptString(encrypted, getEnv().encryptionKey);
}

export const DEFAULT_USER_PERMISSIONS: Permission[] = USER_PERMISSIONS;
