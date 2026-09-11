import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { renameEntry } from "@/server/services/file-service";

const schema = z.object({
  path: z.string(),
  name: z.string().min(1).max(255),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, schema);
    const entry = await renameEntry(user, body.path, body.name);
    await writeAudit({
      userId: user.id,
      ip: await clientIp(),
      action: "RENAME",
      target: entry.path,
      metadata: { from: body.path },
    });
    return jsonOk({ entry });
  } catch (error) {
    return jsonError(error);
  }
}
