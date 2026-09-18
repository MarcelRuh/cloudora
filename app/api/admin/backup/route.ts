import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { nodeStreamResponse } from "@/server/storage/http-file";
import { getEnv } from "@/server/env";
import { prisma } from "@/server/db";

const LAST_BACKUP_KEY = "backup.lastAt";

function pgDumpUrl(databaseUrl: string): string {
  return databaseUrl.replace(/\?.*$/, "");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

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
    const stamp = new Date().toISOString().slice(0, 10);
    const stream = await startPgDumpStream(pgDumpUrl(getEnv().databaseUrl), async () => {
      await prisma.setting.upsert({
        where: { key: LAST_BACKUP_KEY },
        create: { key: LAST_BACKUP_KEY, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
      await writeAudit({ userId: actor.id, ip: await clientIp(), action: "BACKUP_DB", target: stamp });
    });
    void request;
    return nodeStreamResponse(stream, {
      "Content-Type": "application/sql",
      "Content-Disposition": `attachment; filename="cloudora-db-${stamp}.sql"`,
      "Cache-Control": "no-store",
      "Content-Encoding": "identity",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
  } catch (error) {
    return jsonError(error);
  }
}

function startPgDumpStream(databaseUrl: string, onSuccess: () => Promise<void>): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", [databaseUrl, "--no-owner", "--no-acl"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = new PassThrough();
    const errChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk) => errChunks.push(chunk as Buffer));
    child.stdout?.pipe(out);
    child.on("error", (error) => {
      out.destroy(error);
      reject(error);
    });
    child.on("close", (code) => {
      const stderr = Buffer.concat(errChunks).toString("utf8").trim();
      if (code === 0) {
        void onSuccess().catch(() => undefined);
        return;
      }
      const err = new AppError("BACKUP_FAILED", stderr || `pg_dump beendet mit Code ${code}.`, 500);
      if (!out.destroyed) out.destroy(err);
    });
    resolve(out);
  });
}
