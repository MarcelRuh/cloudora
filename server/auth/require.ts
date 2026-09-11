import { AppError } from "@/lib/errors";
import { type Permission, userHasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { requireSession } from "@/server/auth/session";

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireSession();
  if (!userHasPermission(user, permission)) {
    throw new AppError("FORBIDDEN", "Dafür fehlen dir die Berechtigungen.", 403);
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  return requirePermission("users.view");
}
