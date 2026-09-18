import fs from "node:fs";
import path from "node:path";
import type { FolderShareAccess } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { isAdministrator } from "@/lib/permissions";
import { prisma } from "@/server/db";
import { isBuildPhase } from "@/lib/utils";
import { isAbsolutePosixPath, normalizeConfiguredPath } from "@/server/storage/configured-path";

export const HOME_VIRTUAL_ROOT = "/Home";
export const RESERVED_SHARE_SLUGS = new Set([
  "home",
  "users",
  "shared",
  "mnt",
  "media",
  "srv",
  "trash",
  "files",
  "admin",
  "api",
  "storage",
]);

export type FolderShareGrantInput = {
  userId?: string | null;
  roleId?: string | null;
  access: FolderShareAccess;
  subPath?: string;
};

export type FolderShareRecord = {
  id: string;
  name: string;
  slug: string;
  hostPath: string;
  comment: string;
  enabled: boolean;
  grants: FolderShareGrantInput[];
};

let cached: FolderShareRecord[] | null = null;
let loaded = false;

export function slugifyShareName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "share";
}

export function normalizeShareSlug(input: string, fallbackName: string): string {
  const slug = slugifyShareName(input.trim() || fallbackName);
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(slug)) {
    throw new AppError("INVALID_NAME", "Der Freigabename darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.", 400);
  }
  if (RESERVED_SHARE_SLUGS.has(slug)) {
    throw new AppError("INVALID_NAME", "Dieser Freigabename ist reserviert.", 400);
  }
  return slug;
}

export function normalizeShareHostPath(input: string): string {
  const raw = normalizeConfiguredPath(input);
  if (!isAbsolutePosixPath(raw)) {
    throw new AppError("INVALID_PATH", "Der Freigabepfad muss absolut sein, z. B. /mnt/cloudora.", 400);
  }
  if (raw === "/" || raw === "/proc" || raw === "/sys" || raw === "/dev") {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht freigegeben werden.", 400);
  }
  return path.resolve(raw);
}

export function normalizeShareSubPath(input: string, shareHostPath: string): string {
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw || raw === "." || raw === "/" || raw === "./") return "";
  const root = path.resolve(shareHostPath);
  let abs: string;
  if (raw.startsWith("/")) {
    abs = path.resolve(raw);
  } else {
    const parts = raw.split("/").filter(Boolean);
    if (parts.some((part) => part === ".." || part === ".")) {
      throw new AppError("PATH_TRAVERSAL", "Ungültiger Unterordner.", 400);
    }
    abs = path.resolve(root, parts.join("/"));
  }
  if (abs === root) return "";
  const prefix = `${root}/`;
  if (!abs.startsWith(prefix)) {
    throw new AppError("INVALID_PATH", "Der Ordner liegt nicht in dieser Freigabe.", 400);
  }
  return abs.slice(prefix.length).replace(/\\/g, "/");
}

function mapRow(row: {
  id: string;
  name: string;
  slug: string;
  hostPath: string;
  comment: string;
  enabled: boolean;
  grants: Array<{ userId: string | null; roleId: string | null; access: FolderShareAccess; subPath?: string }>;
}): FolderShareRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    hostPath: row.hostPath,
    comment: row.comment,
    enabled: row.enabled,
    grants: row.grants.map((g) => ({
      userId: g.userId,
      roleId: g.roleId,
      access: g.access,
      subPath: g.subPath ?? "",
    })),
  };
}

export function getFolderShares(): FolderShareRecord[] {
  return cached ?? [];
}

export async function hydrateFolderShares(): Promise<FolderShareRecord[]> {
  if (loaded && cached) return cached;
  if (isBuildPhase()) {
    cached = [];
    return cached;
  }
  try {
    const rows = await prisma.folderShare.findMany({
      include: { grants: true },
      orderBy: { name: "asc" },
    });
    cached = rows.map(mapRow);
    loaded = true;
  } catch {
    cached = cached ?? [];
  }
  return cached;
}

export function invalidateFolderShareCache(): void {
  loaded = false;
}

function normalizeGrants(grants: FolderShareGrantInput[], shareHostPath: string): FolderShareGrantInput[] {
  const out: FolderShareGrantInput[] = [];
  const seen = new Set<string>();
  for (const grant of grants) {
    const userId = grant.userId?.trim() || null;
    const roleId = grant.roleId?.trim() || null;
    if (Boolean(userId) === Boolean(roleId)) {
      throw new AppError("VALIDATION_ERROR", "Jede Berechtigung gilt für genau einen Benutzer oder eine Rolle.", 400);
    }
    if (grant.access !== "READ" && grant.access !== "WRITE") {
      throw new AppError("VALIDATION_ERROR", "Ungültige Freigabeberechtigung.", 400);
    }
    const subPath = normalizeShareSubPath(grant.subPath ?? "", shareHostPath);
    const key = `${userId ? `u:${userId}` : `r:${roleId}`}:${subPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId, roleId, access: grant.access, subPath });
  }
  return out;
}

export async function listFolderSharesAdmin() {
  await hydrateFolderShares();
  const rows = await prisma.folderShare.findMany({
    include: {
      grants: {
        include: {
          user: { select: { id: true, username: true, displayName: true } },
          role: { select: { id: true, name: true, slug: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    ...mapRow(row),
    grants: row.grants.map((g) => ({
      id: g.id,
      userId: g.userId,
      roleId: g.roleId,
      access: g.access,
      subPath: g.subPath ?? "",
      user: g.user,
      role: g.role,
    })),
  }));
}

async function replaceGrants(shareId: string, grants: FolderShareGrantInput[]): Promise<void> {
  await prisma.folderShareGrant.deleteMany({ where: { shareId } });
  if (!grants.length) return;
  await prisma.folderShareGrant.createMany({
    data: grants.map((g) => ({
      shareId,
      userId: g.userId || null,
      roleId: g.roleId || null,
      access: g.access,
      subPath: g.subPath ?? "",
    })),
  });
}

export async function createFolderShare(input: {
  name: string;
  slug?: string;
  hostPath: string;
  comment?: string;
  enabled?: boolean;
  grants?: FolderShareGrantInput[];
}) {
  const name = input.name.trim();
  if (!name) throw new AppError("INVALID_NAME", "Name der Freigabe fehlt.", 400);
  const slug = normalizeShareSlug(input.slug || name, name);
  const hostPath = normalizeShareHostPath(input.hostPath);
  const grants = normalizeGrants(input.grants ?? [], hostPath);
  try {
    fs.mkdirSync(hostPath, { recursive: true });
  } catch {
    throw new AppError("STORAGE_ERROR", `Ordner ist nicht erstellbar: ${hostPath}`, 400);
  }
  try {
    const created = await prisma.folderShare.create({
      data: {
        name,
        slug,
        hostPath,
        comment: input.comment?.trim() ?? "",
        enabled: input.enabled !== false,
      },
    });
    await replaceGrants(created.id, grants);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "P2002") throw new AppError("ALREADY_EXISTS", "Eine Freigabe mit diesem Namen existiert bereits.", 409);
    throw error;
  }
  invalidateFolderShareCache();
  await hydrateFolderShares();
  return (await listFolderSharesAdmin()).find((s) => s.slug === slug);
}

export async function updateFolderShare(
  id: string,
  input: Partial<{
    name: string;
    slug: string;
    hostPath: string;
    comment: string;
    enabled: boolean;
    grants: FolderShareGrantInput[];
  }>,
) {
  const current = await prisma.folderShare.findUnique({ where: { id } });
  if (!current) throw new AppError("NOT_FOUND", "Freigabe nicht gefunden.", 404);
  const name = input.name != null ? input.name.trim() : current.name;
  if (!name) throw new AppError("INVALID_NAME", "Name der Freigabe fehlt.", 400);
  const slug = input.slug != null || input.name != null ? normalizeShareSlug(input.slug || name, name) : current.slug;
  const hostPath = input.hostPath != null ? normalizeShareHostPath(input.hostPath) : current.hostPath;
  if (input.hostPath != null) {
    try {
      fs.mkdirSync(hostPath, { recursive: true });
    } catch {
      throw new AppError("STORAGE_ERROR", `Ordner ist nicht erstellbar: ${hostPath}`, 400);
    }
  }
  try {
    await prisma.folderShare.update({
      where: { id },
      data: {
        name,
        slug,
        hostPath,
        comment: input.comment != null ? input.comment.trim() : undefined,
        enabled: input.enabled,
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
    if (code === "P2002") throw new AppError("ALREADY_EXISTS", "Eine Freigabe mit diesem Namen existiert bereits.", 409);
    throw error;
  }
  if (input.grants) await replaceGrants(id, normalizeGrants(input.grants, hostPath));
  invalidateFolderShareCache();
  await hydrateFolderShares();
  return (await listFolderSharesAdmin()).find((s) => s.id === id);
}

export async function deleteFolderShare(id: string): Promise<void> {
  try {
    await prisma.folderShare.delete({ where: { id } });
  } catch {
    throw new AppError("NOT_FOUND", "Freigabe nicht gefunden.", 404);
  }
  invalidateFolderShareCache();
  await hydrateFolderShares();
}

export function accessForShare(
  user: { id?: string; role?: { id?: string; slug?: string; permissions?: readonly string[] } },
  share: FolderShareRecord,
): FolderShareAccess | null {
  if (!share.enabled) return null;
  if (isAdministrator(user)) return "WRITE";
  let access: FolderShareAccess | null = null;
  for (const grant of share.grants) {
    const matchesUser = grant.userId && grant.userId === user.id;
    const matchesRole = grant.roleId && grant.roleId === user.role?.id;
    if (!matchesUser && !matchesRole) continue;
    if ((grant.subPath ?? "") !== "") continue;
    if (grant.access === "WRITE") return "WRITE";
    access = "READ";
  }
  return access;
}

export type VisibleFolder = {
  subPath: string;
  access: FolderShareAccess;
  label: string;
  virtualRoot: string;
  absRoot: string;
};

export function visibleFoldersForUser(
  user: { id?: string; role?: { id?: string; slug?: string; permissions?: readonly string[] } },
  share: FolderShareRecord,
): VisibleFolder[] {
  if (!share.enabled) return [];
  if (isAdministrator(user)) {
    return [
      {
        subPath: "",
        access: "WRITE",
        label: share.name,
        virtualRoot: `/${share.slug}`,
        absRoot: share.hostPath,
      },
    ];
  }
  const matched: VisibleFolder[] = [];
  for (const grant of share.grants) {
    const matchesUser = Boolean(grant.userId && grant.userId === user.id);
    const matchesRole = Boolean(grant.roleId && grant.roleId === user.role?.id);
    if (!matchesUser && !matchesRole) continue;
    const subPath = grant.subPath ?? "";
    matched.push({
      subPath,
      access: grant.access,
      label: subPath ? path.posix.basename(subPath) : share.name,
      virtualRoot: subPath ? `/${share.slug}/${subPath}` : `/${share.slug}`,
      absRoot: subPath ? path.posix.join(share.hostPath.replace(/\\/g, "/"), subPath) : share.hostPath,
    });
  }
  const hasFull = matched.some((item) => item.subPath === "");
  const selected = hasFull ? matched.filter((item) => item.subPath === "") : matched;
  const byPath = new Map<string, VisibleFolder>();
  for (const item of selected) {
    const prev = byPath.get(item.subPath);
    if (!prev || item.access === "WRITE") byPath.set(item.subPath, item);
  }
  return [...byPath.values()];
}

export async function grantAbsoluteFolder(input: {
  userId?: string | null;
  roleId?: string | null;
  hostPath: string;
  access: FolderShareAccess;
}) {
  const userId = input.userId?.trim() || null;
  const roleId = input.roleId?.trim() || null;
  if (Boolean(userId) === Boolean(roleId)) {
    throw new AppError("VALIDATION_ERROR", "Bitte einen Benutzer oder eine Rolle wählen.", 400);
  }
  const hostPath = normalizeShareHostPath(input.hostPath);
  try {
    fs.mkdirSync(hostPath, { recursive: true });
  } catch {
    throw new AppError("STORAGE_ERROR", `Ordner ist nicht erstellbar: ${hostPath}`, 400);
  }
  await hydrateFolderShares();
  const shares = getFolderShares()
    .filter((share) => share.enabled)
    .filter((share) => hostPath === share.hostPath || hostPath.startsWith(`${share.hostPath}/`))
    .sort((a, b) => b.hostPath.length - a.hostPath.length);
  let share = shares[0];
  if (!share) {
    const name = path.basename(hostPath) || "freigabe";
    await createFolderShare({
      name,
      hostPath,
      grants: [{ userId, roleId, access: input.access, subPath: "" }],
    });
    return (await listFolderSharesAdmin()).find((s) => s.hostPath === hostPath);
  }
  const subPath = normalizeShareSubPath(hostPath, share.hostPath);
  const current = await prisma.folderShare.findUnique({
    where: { id: share.id },
    include: { grants: true },
  });
  if (!current) throw new AppError("NOT_FOUND", "Freigabe nicht gefunden.", 404);
  const nextGrants: FolderShareGrantInput[] = current.grants.map((g) => ({
    userId: g.userId,
    roleId: g.roleId,
    access: g.access,
    subPath: g.subPath ?? "",
  }));
  const key = (g: FolderShareGrantInput) => `${g.userId ? `u:${g.userId}` : `r:${g.roleId}`}:${g.subPath ?? ""}`;
  const incoming: FolderShareGrantInput = { userId, roleId, access: input.access, subPath };
  const idx = nextGrants.findIndex((g) => key(g) === key(incoming));
  if (idx >= 0) nextGrants[idx] = incoming;
  else nextGrants.push(incoming);
  return updateFolderShare(share.id, { grants: nextGrants });
}
