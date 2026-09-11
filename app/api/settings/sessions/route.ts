import { z } from "zod";
import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/server/auth/session";
import { assertSameOrigin, COOKIE_NAME, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { prisma } from "@/server/db";
import { hashToken } from "@/server/crypto";

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, z.object({ keepCurrent: z.boolean().optional() }));
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const currentHash = token ? hashToken(token) : "";
    await prisma.session.deleteMany({
      where: {
        userId: user.id,
        ...(body.keepCurrent && currentHash ? { tokenHash: { not: currentHash } } : {}),
      },
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
