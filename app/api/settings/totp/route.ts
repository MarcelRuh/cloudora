import { z } from "zod";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/server/auth/session";
import { assertSameOrigin, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { beginTotpSetup, confirmTotpSetup, disableTotp } from "@/server/services/user-service";

const schema = z.object({
  action: z.enum(["begin", "confirm", "disable"]),
  password: z.string().optional(),
  code: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, schema);
    if (body.action === "begin") {
      if (!body.password) throw new AppError("VALIDATION_ERROR", "Passwort fehlt.", 400);
      return jsonOk(await beginTotpSetup(user.id, body.password));
    }
    if (body.action === "confirm") {
      if (!body.code) throw new AppError("VALIDATION_ERROR", "Code fehlt.", 400);
      await confirmTotpSetup(user.id, body.code);
      return jsonOk({ ok: true, totpEnabled: true });
    }
    if (!body.password || !body.code) throw new AppError("VALIDATION_ERROR", "Passwort und Code fehlen.", 400);
    await disableTotp(user.id, body.password, body.code);
    return jsonOk({ ok: true, totpEnabled: false });
  } catch (error) {
    return jsonError(error);
  }
}
