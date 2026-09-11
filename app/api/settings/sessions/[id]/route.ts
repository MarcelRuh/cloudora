import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/server/auth/session";
import { assertSameOrigin, COOKIE_NAME, clearSessionCookie, jsonError, jsonOk } from "@/server/http";
import { prisma } from "@/server/db";
import { hashToken } from "@/server/crypto";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const { id } = await ctx.params;
    const row = await prisma.session.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new AppError("NOT_FOUND", "Sitzung nicht gefunden.", 404);
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const isCurrent = token ? row.tokenHash === hashToken(token) : false;
    await prisma.session.delete({ where: { id } });
    if (isCurrent) await clearSessionCookie();
    return jsonOk({ ok: true, current: isCurrent });
  } catch (error) {
    return jsonError(error);
  }
}
