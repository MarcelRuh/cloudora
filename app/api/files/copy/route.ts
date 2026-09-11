import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { copyEntry } from "@/server/services/file-service";

const schema = z.object({
  from: z.string(),
  to: z.string(),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, schema);
    const entry = await copyEntry(user, body.from, body.to);
    await writeAudit({
      userId: user.id,
      ip: await clientIp(),
      action: "COPY",
      target: entry.path,
      metadata: { from: body.from, to: body.to },
    });
    return jsonOk({ entry });
  } catch (error) {
    return jsonError(error);
  }
}
