import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { grantAbsoluteFolder } from "@/server/storage/folder-shares";

const schema = z.object({
  userId: z.string().min(1).optional().nullable(),
  roleId: z.string().min(1).optional().nullable(),
  hostPath: z.string().min(2).max(512),
  access: z.enum(["READ", "WRITE"]),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("storage.global");
    const body = await readJson(request, schema);
    const share = await grantAbsoluteFolder(body);
    await writeAudit({
      userId: actor.id,
      ip: await clientIp(),
      action: "GRANT_FOLDER_SHARE",
      target: body.hostPath,
    });
    return jsonOk({ share });
  } catch (error) {
    return jsonError(error);
  }
}
