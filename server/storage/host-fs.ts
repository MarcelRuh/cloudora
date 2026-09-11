import fs from "node:fs";
import path from "node:path";

const BLOCKED_PREFIXES = ["/proc", "/sys", "/dev", "/run"];

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

/** Display path (`/mnt/hdd`) → path the process can open (`/host/mnt/hdd` in Docker). */
export function toFilesystemPath(displayPath: string, hostRoot: string | null = detectHostRoot()): string {
  const abs = path.resolve(displayPath.startsWith("/") ? displayPath : `/${displayPath}`);
  if (!hostRoot) return abs;
  if (abs === hostRoot || abs.startsWith(`${hostRoot}/`)) return abs;
  if (abs === "/storage" || abs.startsWith("/storage/")) return abs;
  if (abs === "/") return hostRoot;
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
