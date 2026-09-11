import { z } from "zod";
import { userHasPermission } from "@/lib/permissions";
import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { createShare, listShares } from "@/server/services/share-service";

export async function GET() {
  try {
    const user = await requireSession();
    const items = await listShares(user, userHasPermission(user, "shares.manage"));
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  path: z.string(),
  permission: z.enum(["READ", "DOWNLOAD", "EDIT"]).optional(),
  password: z.string().min(1).optional(),
  expiresInHours: z.number().int().min(1).max(720).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, schema);
    const item = await createShare(user, body);
    await writeAudit({ userId: user.id, ip: await clientIp(), action: "SHARE_CREATE", target: item.name });
    return jsonOk({ item }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
