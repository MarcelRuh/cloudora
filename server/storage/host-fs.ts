import fs from "node:fs";
import path from "node:path";

const BLOCKED_PREFIXES = ["/proc", "/sys", "/dev", "/run"];
const SKIP_NATIVE_MOUNTS = new Set(["/", "/proc", "/sys", "/dev", "/run", "/dev/pts", "/dev/shm", "/dev/mqueue", "/sys/fs/cgroup"]);

export type FsMapOptions = {
  /** Override `/proc/self/mountinfo` (tests). */
  mounts?: string[];
};

export function detectHostRoot(env: NodeJS.Dict<string | undefined> = process.env): string | null {
  const raw = env.CLOUDORA_HOST_ROOT?.trim();
  if (raw === "0" || raw === "off" || raw === "false") return null;
  if (raw) {
    try {
      const abs = path.resolve(raw);
      if (fs.statSync(abs).isDirectory()) return abs;
    } catch {
      return null;
    }
  }
  try {
    if (fs.statSync("/host").isDirectory()) return "/host";
  } catch {
    /* not mounted */
  }
  return null;
}

export function isBlockedSystemPath(absPath: string, hostRoot: string | null = detectHostRoot()): boolean {
  const normalized = path.resolve(absPath);
  const prefixes = [...BLOCKED_PREFIXES];
  if (hostRoot) {
    for (const prefix of BLOCKED_PREFIXES) {
      prefixes.push(`${hostRoot}${prefix}`);
    }
  }
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function readMountPoints(): string[] {
  const mounts: string[] = [];
  try {
    const text = fs.readFileSync("/proc/self/mountinfo", "utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      const fields = line.split(" ");
      const target = fields[4];
      if (target) mounts.push(target);
    }
  } catch {
    /* no /proc */
  }
  return mounts;
}

/** Longest live mount covering this path, excluding `/` and the read-only `/host` tree. */
export function liveMountCovering(
  absPath: string,
  hostRoot: string | null = detectHostRoot(),
  mounts: string[] = readMountPoints(),
): string | null {
  const abs = path.resolve(absPath);
  const skip = new Set(SKIP_NATIVE_MOUNTS);
  if (hostRoot) {
    skip.add(hostRoot);
    skip.add(path.resolve(hostRoot));
  }
  const covering = mounts
    .filter((mount) => {
      if (!mount || skip.has(mount)) return false;
      if (hostRoot && (mount === hostRoot || mount.startsWith(`${hostRoot}/`))) return false;
      return abs === mount || abs.startsWith(`${mount}/`);
    })
    .sort((a, b) => b.length - a.length);
  return covering[0] ?? null;
}

function isWritableDir(absPath: string): boolean {
  try {
    fs.accessSync(absPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Host path is a real, writable mount in this container (not the `/host` browse bind). */
export function isLiveNativeWritable(
  absPath: string,
  hostRoot: string | null = detectHostRoot(),
  mounts?: string[],
): boolean {
  const abs = path.resolve(absPath);
  if (isHostBrowseFsPath(abs, hostRoot)) return false;
  if (!liveMountCovering(abs, hostRoot, mounts ?? readMountPoints())) return false;
  try {
    const st = fs.statSync(abs);
    if (!st.isDirectory()) return false;
    return isWritableDir(abs);
  } catch {
    return false;
  }
}

/** Display path (`/mnt/hdd`) → path the process can open (`/mnt/hdd` if live, else `/host/mnt/hdd`). */
export function toFilesystemPath(
  displayPath: string,
  hostRoot: string | null = detectHostRoot(),
  options?: FsMapOptions,
): string {
  const abs = path.resolve(displayPath.startsWith("/") ? displayPath : `/${displayPath}`);
  if (!hostRoot) return abs;
  if (abs === hostRoot || abs.startsWith(`${hostRoot}/`)) return abs;
  if (abs === "/") return hostRoot;
  if (liveMountCovering(abs, hostRoot, options?.mounts ?? readMountPoints())) return abs;
  if (abs === "/storage" || abs.startsWith("/storage/")) return abs;
  return path.join(hostRoot, abs);
}

/** Process path → host-style path shown in the picker. */
export function toDisplayPath(fsPath: string, hostRoot: string | null = detectHostRoot()): string {
  const abs = path.resolve(fsPath);
  if (!hostRoot) return abs;
  if (abs === hostRoot) return "/";
  if (abs.startsWith(`${hostRoot}/`)) {
    const sliced = abs.slice(hostRoot.length);
    return sliced.startsWith("/") ? sliced : `/${sliced}`;
  }
  return abs;
}

/** True when the process path is the read-only host browse mount (`/host/...`). */
export function isHostBrowseFsPath(fsPath: string, hostRoot: string | null = detectHostRoot()): boolean {
  if (!hostRoot) return false;
  const abs = path.resolve(fsPath);
  return abs === hostRoot || abs.startsWith(`${hostRoot}/`);
}

/** Whether this absolute path is a live mount point in the current mount namespace. */
export function isMountPoint(absPath: string, mounts: string[] = readMountPoints()): boolean {
  const target = path.resolve(absPath);
  return mounts.includes(target);
}
