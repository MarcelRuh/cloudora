import { isInsideStorageRoot } from "@/lib/posix-path";
import { isAbsolutePosixPath } from "@/server/storage/configured-path";

/** Absolute Compose bind on the host, e.g. `/mnt/cloudora`. Relative `./storage` is ignored. */
export function normalizeHostStoragePath(hostStorage: string): string {
  const raw = hostStorage.replace(/\\/g, "/").trim().replace(/\/+$/, "");
  if (!raw || raw === "." || raw.startsWith("./")) return "";
  return raw.startsWith("/") ? raw : "";
}

/** If the admin picked the Compose bind (e.g. /mnt/cloudora), map onto a volume-relative path. */
export function remapConfiguredOntoHostStorage(
  configured: string,
  hostStorage: string,
  volumeRootFallback: string,
): string {
  const host = normalizeHostStoragePath(hostStorage);
  const raw = configured.replace(/\\/g, "/").trim().replace(/\/+$/, "") || configured.trim();
  if (!host || !raw) return configured;
  if (raw === host) return volumeRootFallback;
  if (raw.startsWith(`${host}/`)) return raw.slice(host.length + 1) || volumeRootFallback;
  return configured;
}

/** Host display path → path inside the container volume, or null if it is not the Compose bind. */
export function filesystemPathOnHostStorage(
  displayPath: string,
  hostStorage: string,
  storageRoot: string,
): string | null {
  const host = normalizeHostStoragePath(hostStorage);
  const raw = displayPath.replace(/\\/g, "/").trim().replace(/\/+$/, "") || "/";
  if (!host) return null;
  const root = storageRoot.replace(/\/+$/, "") || "/storage";
  if (raw === host) return root;
  if (raw.startsWith(`${host}/`)) {
    const rest = raw.slice(host.length + 1);
    return rest ? `${root}/${rest}` : root;
  }
  return null;
}

export function configuredPathNeedsHostBind(
  configured: string,
  storageRoot: string,
  hostStorage = "",
): boolean {
  const remapped = remapConfiguredOntoHostStorage(configured, hostStorage, "shared");
  const raw = remapped.replace(/\\/g, "/").trim();
  if (!isAbsolutePosixPath(raw)) return false;
  if (isInsideStorageRoot(raw, storageRoot)) return false;
  const host = normalizeHostStoragePath(hostStorage);
  if (host && (raw === host || raw.startsWith(`${host}/`))) return false;
  return true;
}
