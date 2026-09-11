import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { revokeOneTimeDownload } from "@/server/services/download-service";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const { id } = await ctx.params;
    await revokeOneTimeDownload(user, id);
    await writeAudit({ userId: user.id, ip: await clientIp(), action: "OTD_DELETE", target: id });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
