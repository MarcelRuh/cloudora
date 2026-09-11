import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { queryParam, readJson } from "@/server/http-parse";
import { readEditableContent, saveAs, writeEditableContent } from "@/server/services/file-service";

export async function GET(request: Request) {
  try {
    const user = await requireSession();
    const url = new URL(request.url);
    const data = await readEditableContent(user, queryParam(url, "path"));
    return jsonOk(data);
  } catch (error) {
    return jsonError(error);
  }
}

const putSchema = z.object({
  path: z.string(),
  content: z.string(),
  saveAsName: z.string().optional(),
});

export async function PUT(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, putSchema);
    const entry = body.saveAsName
      ? await saveAs(user, body.path, body.saveAsName, body.content)
      : await writeEditableContent(user, body.path, body.content);
    await writeAudit({ userId: user.id, ip: await clientIp(), action: "EDIT", target: entry.path });
    return jsonOk({ entry });
  } catch (error) {
    return jsonError(error);
  }
}
