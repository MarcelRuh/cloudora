/** Client-safe POSIX helpers for admin path fields. No Node APIs. */

export function isAbsolutePosixPath(value: string): boolean {
  return value.startsWith("/");
}

export function normalizePosixAbs(input: string): string {
  const raw = input.replace(/\\/g, "/").trim() || "/";
  const parts = raw.split("/").filter((part) => part && part !== ".");
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function trimPosix(input: string): string {
  return input.replace(/\\/g, "/").replace(/\/+$/, "").trim();
}

export function isInsideStorageRoot(absPath: string, storageRoot: string): boolean {
  const abs = normalizePosixAbs(absPath);
  const root = normalizePosixAbs(storageRoot);
  if (root === "/") return true;
  return abs === root || abs.startsWith(`${root}/`);
}

/** Absolute path stays absolute; under the volume it becomes relative (`users/anna`). */
export function toConfiguredFromAbsolute(
  absPath: string,
  storageRoot: string,
  preferRelative: boolean,
): string {
  const abs = normalizePosixAbs(absPath);
  const root = normalizePosixAbs(storageRoot);
  if (abs === "/") return abs;
  if (!preferRelative) return abs;
  if (root === "/" || abs === root) return abs;
  if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
  return abs;
}

export function joinPosix(base: string, name: string): string {
  const safe = name.trim();
  const trimmed = trimPosix(base);
  if (!safe) return trimmed;
  if (!trimmed) return safe;
  return `${trimmed}/${safe}`;
}

export function suggestUserHome(usersDir: string, username: string): string {
  const name = username.trim().toLowerCase();
  if (!name) return "";
  return joinPosix(usersDir || "users", name);
}
