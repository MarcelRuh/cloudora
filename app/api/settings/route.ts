import { z } from "zod";
import { cookies } from "next/headers";
import { requireSession } from "@/server/auth/session";
import { assertSameOrigin, COOKIE_NAME, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { changeOwnPassword, updateOwnProfile } from "@/server/services/user-service";
import { prisma } from "@/server/db";
import { hashToken } from "@/server/crypto";

export async function GET() {
  try {
    const user = await requireSession();
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const currentHash = token ? hashToken(token) : "";
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true, tokenHash: true },
    });
    return jsonOk({
      user,
      sessions: sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.tokenHash === currentHash,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  appearance: z.enum(["dark", "light"]).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
});

export async function PATCH(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, schema);
    if (body.newPassword) {
      if (!body.currentPassword) {
        return jsonError(new Error("Aktuelles Passwort fehlt."));
      }
      await changeOwnPassword(user.id, body.currentPassword, body.newPassword);
    }
    const next = await updateOwnProfile(user.id, {
      displayName: body.displayName,
      appearance: body.appearance,
    });
    return jsonOk({ user: next });
  } catch (error) {
    return jsonError(error);
  }
}
