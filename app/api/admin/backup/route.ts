import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { getEnv } from "@/server/env";
import { prisma } from "@/server/db";
import { randomToken } from "@/server/crypto";

const LAST_BACKUP_KEY = "backup.lastAt";

function pgDumpUrl(databaseUrl: string): string {
  return databaseUrl.replace(/\?.*$/, "");
}

export async function GET() {
  try {
    await requirePermission("system.view");
    const env = getEnv();
    const last = await prisma.setting.findUnique({ where: { key: LAST_BACKUP_KEY } });
    const lastAt = typeof last?.value === "string" ? last.value : null;
    return jsonOk({
      lastBackupAt: lastAt,
      hostStorage: env.hostStorage,
      storagePath: env.storagePath,
      note: "Die Datenbank kannst du hier als SQL herunterladen. Dateien separat vom Host-Mount sichern.",
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("system.update");
    const env = getEnv();
    const stamp = new Date().toISOString().slice(0, 10);
    const tmp = path.join(os.tmpdir(), `cloudora-db-${stamp}-${randomToken(8)}.sql`);
    await runPgDump(pgDumpUrl(env.databaseUrl), tmp);
    const body = await fs.readFile(tmp);
    await fs.unlink(tmp).catch(() => undefined);
    await prisma.setting.upsert({
      where: { key: LAST_BACKUP_KEY },
      create: { key: LAST_BACKUP_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    });
    await writeAudit({ userId: actor.id, ip: await clientIp(), action: "BACKUP_DB", target: stamp });
    void request;
    return new Response(body, {
      headers: {
        "Content-Type": "application/sql",
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="cloudora-db-${stamp}.sql"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

function runPgDump(databaseUrl: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", [databaseUrl, "--no-owner", "--no-acl", "-f", dest], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const errChunks: Buffer[] = [];
    child.stderr.on("data", (chunk) => errChunks.push(chunk as Buffer));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stderr = Buffer.concat(errChunks).toString("utf8").trim();
      if (code === 0) {
        resolve();
        return;
      }
      reject(new AppError("BACKUP_FAILED", stderr || `pg_dump beendet mit Code ${code}.`, 500));
    });
  });
}
