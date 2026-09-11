import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import {
  ensureExtraVolumeDirs,
  hydrateExtraVolumes,
  requestComposeApply,
  saveExtraVolumes,
} from "@/server/storage/extra-volumes";
import { hydrateStoragePaths } from "@/server/storage/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("system.view");
    const [volumes, paths] = await Promise.all([hydrateExtraVolumes(), hydrateStoragePaths()]);
    return jsonOk({ extraVolumes: volumes, storagePath: paths.storagePath });
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  extraVolumes: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        name: z.string().min(1).max(64),
        hostPath: z.string().min(2).max(512),
      }),
    )
    .max(32),
  apply: z.boolean().optional(),
});

export async function PUT(request: Request) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const body = await readJson(request, schema);
    const volumes = await saveExtraVolumes(body.extraVolumes);
    const paths = await hydrateStoragePaths();
    ensureExtraVolumeDirs(paths.storagePath, volumes);
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "UPDATE_STORAGE_VOLUMES",
      target: volumes.map((vol) => vol.id).join(",") || "none",
    });
    let apply: { mode: "sidecar" | "manual" | "live"; message: string } | null = null;
    if (body.apply) {
      apply = requestComposeApply(volumes, paths.storagePath);
    }
    return jsonOk({ extraVolumes: volumes, apply });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const volumes = await hydrateExtraVolumes();
    const paths = await hydrateStoragePaths();
    ensureExtraVolumeDirs(paths.storagePath, volumes);
    const apply = requestComposeApply(volumes, paths.storagePath);
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "APPLY_STORAGE_VOLUMES",
      target: volumes.map((vol) => vol.id).join(",") || "none",
      result: apply.mode === "manual" ? "FAILURE" : "SUCCESS",
      error: apply.mode === "manual" ? apply.message : null,
    });
    return jsonOk(apply, apply.mode === "manual" ? 400 : 200);
  } catch (error) {
    return jsonError(error);
  }
}
