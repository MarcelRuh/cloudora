import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { deleteShare, revokeShare } from "@/server/services/share-service";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const { id } = await ctx.params;
    const hard = new URL(request.url).searchParams.get("hard") === "1";
    if (hard) {
      await deleteShare(user, id);
      await writeAudit({ userId: user.id, ip: await clientIp(), action: "SHARE_PURGE", target: id });
    } else {
      await revokeShare(user, id);
      await writeAudit({ userId: user.id, ip: await clientIp(), action: "SHARE_REVOKE", target: id });
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
