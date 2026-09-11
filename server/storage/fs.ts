import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { AppError } from "@/lib/errors";
import { isInsideRoot } from "@/server/storage/path-resolver";

export async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function statOrNull(absPath: string) {
  try {
    return await fs.stat(absPath);
  } catch {
    return null;
  }
}

export async function listDirectory(absPath: string) {
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  return entries.filter((entry) => entry.name !== "." && entry.name !== "..");
}

export async function ensureDir(absPath: string): Promise<void> {
  await fs.mkdir(absPath, { recursive: true });
}

export async function removePath(absPath: string): Promise<void> {
  await fs.rm(absPath, { recursive: true, force: false });
}

export async function renamePath(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EXDEV") throw error;
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await fs.rm(from, { recursive: true, force: true });
  }
}

export async function copyPath(from: string, to: string): Promise<void> {
  await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
}

export async function writeStreamToFile(absPath: string, stream: Readable, maxBytes: number): Promise<number> {
  await ensureDir(path.dirname(absPath));
  const handle = await fs.open(absPath, "w");
  const dest = handle.createWriteStream();
  let written = 0;
  stream.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > maxBytes) {
      stream.destroy(new AppError("FILE_TOO_LARGE", "Die Datei überschreitet das Upload-Limit.", 413));
    }
  });
  try {
    await pipeline(stream, dest);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(absPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close().catch(() => undefined);
  return written;
}

export async function readFileLimited(absPath: string, maxBytes: number): Promise<Buffer> {
  const stat = await fs.stat(absPath);
  if (stat.size > maxBytes) {
    throw new AppError("FILE_TOO_LARGE", "Die Datei ist zu groß für den Editor.", 413, {
      maxBytes,
      size: stat.size,
    });
  }
  return fs.readFile(absPath);
}

export async function writeFileAtomic(absPath: string, content: string | Buffer): Promise<number> {
  const dir = path.dirname(absPath);
  await ensureDir(dir);
  const tmp = `${absPath}.cloudora-tmp-${process.pid}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, absPath);
  const stat = await fs.stat(absPath);
  return Number(stat.size);
}

export async function directorySize(absPath: string, jailRoot: string): Promise<bigint> {
  let total = BigInt(0);
  async function walk(current: string): Promise<void> {
    if (!isInsideRoot(jailRoot, current)) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (!isInsideRoot(jailRoot, next)) continue;
      try {
        if (entry.isDirectory()) {
          await walk(next);
        } else if (entry.isFile()) {
          const st = await fs.stat(next);
          total += BigInt(st.size);
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  await walk(absPath);
  return total;
}
