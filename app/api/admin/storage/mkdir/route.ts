import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { getEnv } from "@/server/env";
import { hydrateStoragePaths } from "@/server/storage/config";
import { mkdirLinuxDirectory } from "@/server/storage/browse-linux";

const schema = z.object({
  dir: z.string().min(1).max(512),
  name: z.string().min(1).max(255),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const body = await readJson(request, schema);
    const paths = await hydrateStoragePaths();
    const created = mkdirLinuxDirectory(body.dir, body.name, [], paths.storagePath, getEnv().hostStorage);
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "ADMIN_MKDIR",
      target: created,
    });
    return jsonOk({ path: created }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
