import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { createFolderShare, listFolderSharesAdmin } from "@/server/storage/folder-shares";

const grantSchema = z.object({
  userId: z.string().min(1).optional().nullable(),
  roleId: z.string().min(1).optional().nullable(),
  access: z.enum(["READ", "WRITE"]),
  subPath: z.string().max(512).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().max(48).optional(),
  hostPath: z.string().min(2).max(512),
  comment: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  grants: z.array(grantSchema).max(200).optional(),
});

export async function GET() {
  try {
    await requirePermission("storage.global");
    return jsonOk({ shares: await listFolderSharesAdmin() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const body = await readJson(request, createSchema);
    const share = await createFolderShare(body);
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "CREATE_FOLDER_SHARE",
      target: share?.slug,
    });
    return jsonOk({ share }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
