import path from "node:path";
import { AppError } from "@/lib/errors";
import { pathExists } from "@/server/storage/fs";

export function numberedFileName(original: string, index: number): string {
  if (index <= 0) return original;
  const dot = original.lastIndexOf(".");
  if (dot > 0 && !original.startsWith(".")) {
    return `${original.slice(0, dot)} (${index})${original.slice(dot)}`;
  }
  return `${original} (${index})`;
}

export async function uniqueFileName(parentAbs: string, fileName: string, max = 200): Promise<string> {
  let candidate = fileName;
  let i = 0;
  while (await pathExists(path.join(parentAbs, candidate))) {
    i += 1;
    if (i > max) {
      throw new AppError("ALREADY_EXISTS", "Ein Eintrag mit diesem Namen existiert bereits.", 409);
    }
    candidate = numberedFileName(fileName, i);
  }
  return candidate;
}
