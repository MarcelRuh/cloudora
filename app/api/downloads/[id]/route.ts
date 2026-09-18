import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { deleteOneTimeDownload, revokeOneTimeDownload } from "@/server/services/download-service";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const { id } = await ctx.params;
    const hard = new URL(request.url).searchParams.get("hard") === "1";
    if (hard) {
      await deleteOneTimeDownload(user, id);
      await writeAudit({ userId: user.id, ip: await clientIp(), action: "OTD_PURGE", target: id });
    } else {
      await revokeOneTimeDownload(user, id);
      await writeAudit({ userId: user.id, ip: await clientIp(), action: "OTD_REVOKE", target: id });
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
