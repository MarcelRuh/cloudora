import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { queryParam, readJson } from "@/server/http-parse";
import { deleteEntry, listFiles } from "@/server/services/file-service";

export async function GET(request: Request) {
  try {
    const user = await requireSession();
    const url = new URL(request.url);
    const data = await listFiles(user, queryParam(url, "path", "/"));
    return jsonOk(data);
  } catch (error) {
    return jsonError(error);
  }
}

const deleteSchema = z.object({
  paths: z.array(z.string()).min(1).max(100),
});

export async function DELETE(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, deleteSchema);
    const ip = await clientIp();
    for (const p of body.paths) {
      await deleteEntry(user, p);
      await writeAudit({ userId: user.id, ip, action: "DELETE", target: p });
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
