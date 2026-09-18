import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { deleteFolderShare, updateFolderShare } from "@/server/storage/folder-shares";

const grantSchema = z.object({
  userId: z.string().min(1).optional().nullable(),
  roleId: z.string().min(1).optional().nullable(),
  access: z.enum(["READ", "WRITE"]),
  subPath: z.string().max(512).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  slug: z.string().max(48).optional(),
  hostPath: z.string().min(2).max(512).optional(),
  comment: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  grants: z.array(grantSchema).max(200).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const { id } = await context.params;
    const body = await readJson(request, patchSchema);
    const share = await updateFolderShare(id, body);
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "UPDATE_FOLDER_SHARE",
      target: share?.slug ?? id,
    });
    return jsonOk({ share });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const { id } = await context.params;
    await deleteFolderShare(id);
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "DELETE_FOLDER_SHARE",
      target: id,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
