import { destroySession, getSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, clientUserAgent, jsonError, jsonOk } from "@/server/http";

export async function POST() {
  try {
    await assertSameOrigin();
    const session = await getSession();
    const ip = await clientIp();
    const ua = await clientUserAgent();
    await destroySession();
    if (session) {
      await writeAudit({
        userId: session.id,
        ip,
        userAgent: ua,
        action: "LOGOUT",
        target: session.username,
      });
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
