import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { revokeShare } from "@/server/services/share-service";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const { id } = await ctx.params;
    await revokeShare(user, id);
    await writeAudit({ userId: user.id, ip: await clientIp(), action: "SHARE_REVOKE", target: id });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
