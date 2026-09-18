import { NextResponse } from "next/server";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { jsonOk } from "@/server/http";
import { prisma } from "@/server/db";
import { storageRootAbs } from "@/server/storage/config";
import { APP_NAME, APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = { db: false, storage: false };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    checks.db = false;
  }
  try {
    await access(storageRootAbs(), fsConstants.W_OK);
    checks.storage = true;
  } catch {
    checks.storage = false;
  }
  const ok = checks.db && checks.storage;
  const body = { ok, app: APP_NAME, version: APP_VERSION, checks };
  if (!ok) return NextResponse.json(body, { status: 503 });
  return jsonOk(body);
}
