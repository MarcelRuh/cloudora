export function fileIndexKey(scopeKind: string, virtualPath: string): string {
  return `${scopeKind}:${virtualPath}`;
}

export function parseFileIndexKey(key: string): { scopeKind: string; virtualPath: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const virtualPath = key.slice(idx + 1);
  if (!virtualPath.startsWith("/")) return null;
  return { scopeKind: key.slice(0, idx), virtualPath };
}

export function fileIndexVisibleFilter(scopeKind: string, virtualRoots: string[]) {
  return virtualRoots.flatMap((root) => {
    const key = fileIndexKey(scopeKind, root);
    return [{ virtualPath: key }, { virtualPath: { startsWith: `${key}/` } }];
  });
}

export function isTrashIndexPath(virtualPath: string): boolean {
  return virtualPath === "/.trash" || virtualPath.includes("/.trash/") || virtualPath.endsWith("/.trash");
}
