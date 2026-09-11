import { ALL_PERMISSIONS, USER_PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { hashPassword } from "@/server/auth/password";
import { ensureStorageLayout, sanitizeHomeRelPath, defaultHomePath } from "@/server/storage/scope";
import { hydrateStoragePaths } from "@/server/storage/config";

export async function bootstrapCloudora(): Promise<void> {
  await hydrateStoragePaths();
  ensureStorageLayout();
  const env = getEnv();

  const adminRole = await prisma.role.upsert({
    where: { slug: "administrator" },
    update: { permissions: [...ALL_PERMISSIONS], isSystem: true, name: "Administrator" },
    create: {
      name: "Administrator",
      slug: "administrator",
      description: "Vollzugriff auf Cloudora",
      isSystem: true,
      permissions: [...ALL_PERMISSIONS],
    },
  });

  await prisma.role.upsert({
    where: { slug: "user" },
    update: { permissions: [...USER_PERMISSIONS], isSystem: true, name: "Benutzer" },
    create: {
      name: "Benutzer",
      slug: "user",
      description: "Zugriff auf zugewiesene Dateien und Freigaben",
      isSystem: true,
      permissions: [...USER_PERMISSIONS],
    },
  });

  const username = env.bootstrapAdminUsername.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    const homePath = sanitizeHomeRelPath(defaultHomePath(username), username);
    await prisma.user.create({
      data: {
        username,
        displayName: env.bootstrapAdminUsername,
        email: env.bootstrapAdminEmail.toLowerCase(),
        passwordHash: await hashPassword(env.bootstrapAdminPassword),
        roleId: adminRole.id,
        homePathEnabled: false,
        homePath,
        quotaBytes: null,
      },
    });
    logger.info({ username }, "bootstrap admin created");
  }

  await prisma.setting.upsert({
    where: { key: "initialized" },
    update: { value: { at: new Date().toISOString(), version: "1.0.0" } },
    create: { key: "initialized", value: { at: new Date().toISOString(), version: "1.0.0" } },
  });
}
