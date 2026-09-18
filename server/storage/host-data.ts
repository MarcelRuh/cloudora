import fs from "node:fs";
import path from "node:path";

/** Always bind-mounted into the container. No extra volume UI. */
export const HOST_DATA_ROOTS = ["/mnt", "/media", "/srv"] as const;

export function isHostDataPath(absOrVirtual: string): boolean {
  return hostDataRootFor(absOrVirtual) != null;
}

export function hostDataRootFor(absOrVirtual: string): string | null {
  const raw = absOrVirtual.replace(/\\/g, "/").trim();
  if (!raw.startsWith("/")) return null;
  const abs = path.resolve(raw);
  return HOST_DATA_ROOTS.find((root) => abs === root || abs.startsWith(`${root}/`)) ?? null;
}

export function isHostDataRoot(absOrVirtual: string): boolean {
  const raw = absOrVirtual.replace(/\\/g, "/").trim();
  if (!raw.startsWith("/")) return false;
  const abs = path.resolve(raw);
  return HOST_DATA_ROOTS.some((root) => path.resolve(root) === abs);
}

export function liveHostDataRoots(): string[] {
  return HOST_DATA_ROOTS.filter((root) => {
    try {
      return fs.statSync(/* turbopackIgnore: true */ root).isDirectory();
    } catch {
      return false;
    }
  });
}

export function hostDataMount(
  absOrVirtual: string,
): { label: string; name: string; hostPath: string } | null {
  const root = hostDataRootFor(absOrVirtual);
  if (!root) return null;
  const hostPath = path.resolve(absOrVirtual.replace(/\\/g, "/"));
  const name = hostPath === root ? root.slice(1) : path.basename(hostPath);
  return { label: "Host-Ordner", name, hostPath };
}
