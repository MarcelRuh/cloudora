import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import { isBuildPhase } from "@/lib/utils";
import { isSignalDirReady, resolveUpdateSignalDir } from "@/lib/self-update-signal";
import { resolveConfiguredPath } from "@/server/storage/configured-path";
import { assertSafeFileName } from "@/server/storage/path-resolver";
import { isBlockedSystemPath } from "@/server/storage/host-fs";
import { configuredPathNeedsHostBind } from "@/server/storage/host-storage";
import { normalizeBrowsePath } from "@/server/storage/browse-linux";

export {
  configuredPathNeedsHostBind,
  remapConfiguredOntoHostStorage,
  normalizeHostStoragePath,
} from "@/server/storage/host-storage";

export const EXTRA_VOLUMES_KEY = "storage.extraVolumes";
export const EXTRA_VOLUMES_DIR = "volumes";
export const COMPOSE_VOLUMES_FILE = "docker-compose.cloudora-volumes.yml";
export const SIGNAL_VOLUMES_FILE = "extra-volumes.yml";
export const SIGNAL_COMPOSE_UP = "compose-up";
export const AUTO_USERS_VOLUME_ID = "users-host";
export const AUTO_SHARED_VOLUME_ID = "shared-host";

export type ExtraVolume = {
  id: string;
  name: string;
  hostPath: string;
};

export type VolumeBind = {
  id: string;
  hostPath: string;
  containerPath: string;
};

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const RESERVED = new Set(["users", "shared", "volumes", "trash", "host"]);

export function slugifyVolumeId(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug;
}

/** Display name from a host path (`/mnt/nas/photos` → `photos`). */
export function suggestVolumeName(hostPath: string): string {
  const last = hostPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  return last.slice(0, 64) || "daten";
}

export function parseExtraVolumes(value: unknown): ExtraVolume[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ExtraVolume[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = slugifyVolumeId(String(rec.id ?? rec.name ?? ""));
    const hostPath = String(rec.hostPath ?? "").trim();
    const name = String(rec.name ?? id).trim() || id;
    if (!id || seen.has(id)) continue;
    try {
      const vol = normalizeExtraVolume({ id, name, hostPath });
      seen.add(vol.id);
      out.push(vol);
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

export function normalizeExtraVolume(input: { id: string; name: string; hostPath: string }): ExtraVolume {
  const id = slugifyVolumeId(input.id || input.name);
  if (!ID_RE.test(id) || RESERVED.has(id)) {
    throw new AppError("INVALID_PATH", "Ungültiger Volume-Name. Nur a-z, 0-9, Bindestrich. Nicht users/shared/volumes.", 400);
  }
  assertSafeFileName(id);
  const hostPath = normalizeBrowsePath(input.hostPath);
  if (hostPath === "/") {
    throw new AppError("INVALID_PATH", "Die Wurzel / kann nicht als Volume gelinkt werden. Wähle z. B. /mnt/hdd oder /home.", 400);
  }
  if (isBlockedSystemPath(hostPath, null)) {
    throw new AppError("FORBIDDEN", "Dieser Systempfad kann nicht gelinkt werden.", 403);
  }
  const name = input.name.trim() || suggestVolumeName(hostPath);
  if (name.length > 64) {
    throw new AppError("INVALID_PATH", "Der Anzeigename ist zu lang.", 400);
  }
  return { id, name, hostPath };
}

export function extraVolumeContainerPath(storagePath: string, id: string): string {
  const root = storagePath.replace(/\/+$/, "") || "/storage";
  return `${root}/${EXTRA_VOLUMES_DIR}/${id}`;
}

export function extraVolumeForAbsPath(
  absPath: string,
  storageRoot: string,
  volumes: ExtraVolume[],
): ExtraVolume | null {
  const resolved = path.resolve(absPath);
  for (const vol of volumes) {
    const target = extraVolumeContainerPath(storageRoot, vol.id);
    if (resolved === target || resolved.startsWith(`${target}${path.sep}`) || resolved.startsWith(`${target}/`)) {
      return vol;
    }
  }
  return null;
}

export function extraVolumeForChildName(
  parentAbs: string,
  childName: string,
  storageRoot: string,
  volumes: ExtraVolume[],
): ExtraVolume | null {
  const volumesDir = path.resolve(storageRoot.replace(/\/+$/, "") || "/storage", EXTRA_VOLUMES_DIR);
  if (path.resolve(parentAbs) !== volumesDir) return null;
  return volumes.find((vol) => vol.id === childName) ?? null;
}

export function isExtraVolumeRoot(absPath: string, storageRoot: string, volumes: ExtraVolume[]): boolean {
  const resolved = path.resolve(absPath);
  return volumes.some((vol) => resolved === extraVolumeContainerPath(storageRoot, vol.id));
}

export function extraVolumeBinds(storagePath: string, volumes: ExtraVolume[]): VolumeBind[] {
  return volumes.map((vol) => ({
    id: vol.id,
    hostPath: vol.hostPath,
    containerPath: extraVolumeContainerPath(storagePath, vol.id),
  }));
}

export function syncAutoExtraVolumes(
  current: ExtraVolume[],
  storagePath: string,
  usersDir: string,
  sharedDir: string,
  hostStorage = "",
): ExtraVolume[] {
  const autoIds = new Set([AUTO_USERS_VOLUME_ID, AUTO_SHARED_VOLUME_ID]);
  const next = current.filter((vol) => !autoIds.has(vol.id));

  const upsert = (id: string, name: string, configured: string) => {
    if (!configuredPathNeedsHostBind(configured, storagePath, hostStorage)) return;
    if (next.some((vol) => vol.hostPath === configured)) return;
    next.push(normalizeExtraVolume({ id, name, hostPath: configured }));
  };

  upsert(AUTO_USERS_VOLUME_ID, "Benutzer-Ordner", usersDir);
  upsert(AUTO_SHARED_VOLUME_ID, "Shared-Ordner", sharedDir);
  return next;
}

export function extraVolumesFingerprint(volumes: ExtraVolume[]): string {
  return volumes
    .map((vol) => `${vol.id}=${vol.hostPath}`)
    .sort()
    .join("|");
}

let cachedVolumes: ExtraVolume[] | null = null;
let volumesLoaded = false;

export function resolveThroughExtraVolumes(
  configured: string,
  storageRoot: string,
  volumes: ExtraVolume[],
): string {
  const resolved = resolveConfiguredPath(configured, storageRoot);
  for (const vol of volumes) {
    const container = extraVolumeContainerPath(storageRoot, vol.id);
    if (resolved === container || resolved.startsWith(`${container}/`)) return resolved;
    const hostAbs = vol.hostPath.startsWith("/") ? vol.hostPath : `/${vol.hostPath}`;
    if (resolved === hostAbs) return container;
    if (resolved.startsWith(`${hostAbs}/`)) return `${container}${resolved.slice(hostAbs.length)}`;
  }
  return resolved;
}

export function getCachedExtraVolumes(): ExtraVolume[] {
  return cachedVolumes ?? [];
}

function yamlScalar(value: string): string {
  if (value === "" || /[\s:#{}[\],&*?|<>=!%@`'"]/.test(value)) return JSON.stringify(value);
  return value;
}

export function extraVolumesComposeYaml(volumes: ExtraVolume[], storagePath: string): string {
  if (volumes.length === 0) {
    return "# Generated by Cloudora. Do not edit.\n# No extra volumes.\nservices: {}\n";
  }
  const lines = ["# Generated by Cloudora. Do not edit.", "services:", "  cloudora:", "    volumes:"];
  for (const vol of volumes) {
    const target = extraVolumeContainerPath(storagePath, vol.id);
    lines.push(`      - ${yamlScalar(vol.hostPath)}:${yamlScalar(target)}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function hydrateExtraVolumes(): Promise<ExtraVolume[]> {
  if (volumesLoaded && cachedVolumes) return cachedVolumes;
  if (isBuildPhase()) {
    cachedVolumes = [];
    return cachedVolumes;
  }
  try {
    const row = await prisma.setting.findUnique({ where: { key: EXTRA_VOLUMES_KEY } });
    cachedVolumes = parseExtraVolumes(row?.value);
    volumesLoaded = true;
  } catch {
    cachedVolumes = [];
  }
  return cachedVolumes;
}

export async function saveExtraVolumes(input: ExtraVolume[]): Promise<ExtraVolume[]> {
  const seen = new Set<string>();
  const next: ExtraVolume[] = [];
  for (const item of input) {
    const vol = normalizeExtraVolume(item);
    if (seen.has(vol.id) || seen.has(vol.hostPath)) {
      throw new AppError("CONFLICT", "Volume-Name oder Host-Pfad ist doppelt.", 409);
    }
    seen.add(vol.id);
    seen.add(vol.hostPath);
    next.push(vol);
  }
  await prisma.setting.upsert({
    where: { key: EXTRA_VOLUMES_KEY },
    update: { value: next },
    create: { key: EXTRA_VOLUMES_KEY, value: next },
  });
  cachedVolumes = next;
  volumesLoaded = true;
  return next;
}

export function ensureExtraVolumeDirs(storagePath: string, volumes: ExtraVolume[]): void {
  const root = path.join(storagePath.replace(/\/+$/, "") || "/storage", EXTRA_VOLUMES_DIR);
  fs.mkdirSync(root, { recursive: true });
  for (const vol of volumes) {
    fs.mkdirSync(path.join(root, vol.id), { recursive: true });
  }
}

export function writeVolumeApplySignal(signalDir: string, yaml: string): void {
  fs.mkdirSync(signalDir, { recursive: true });
  fs.writeFileSync(path.join(signalDir, SIGNAL_VOLUMES_FILE), yaml, "utf8");
  const dest = path.join(signalDir, SIGNAL_COMPOSE_UP);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, `${new Date().toISOString()}\n`, "utf8");
  fs.renameSync(tmp, dest);
}

export function requestComposeApply(
  volumes: ExtraVolume[],
  storagePath: string,
): { mode: "sidecar" | "manual"; message: string; yaml: string } {
  const yaml = extraVolumesComposeYaml(volumes, storagePath);
  const signalDir = resolveUpdateSignalDir();
  if (!isSignalDirReady(signalDir)) {
    return {
      mode: "manual",
      message:
        "Sidecar fehlt. docker-compose.cloudora-volumes.yml im Installationsverzeichnis anlegen und docker compose up -d --no-build ausführen.",
      yaml,
    };
  }
  writeVolumeApplySignal(signalDir, yaml);
  return {
    mode: "sidecar",
    message: "Host-Ordner werden als Volume gemountet. Der Container startet in wenigen Sekunden neu.",
    yaml,
  };
}
