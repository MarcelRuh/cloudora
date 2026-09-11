import { z } from "zod";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { emptyTrash, listTrash, purgeTrashItem, restoreTrashItem } from "@/server/services/trash-service";

export async function GET() {
  try {
    const user = await requireSession();
    return jsonOk({ items: await listTrash(user) });
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  action: z.enum(["restore", "purge", "empty"]),
  id: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, schema);
    const ip = await clientIp();
    if (body.action === "empty") {
      const result = await emptyTrash(user);
      await writeAudit({ userId: user.id, ip, action: "TRASH_EMPTY", target: String(result.count) });
      return jsonOk(result);
    }
    if (!body.id) throw new AppError("VALIDATION_ERROR", "id fehlt.", 400);
    if (body.action === "restore") {
      const restored = await restoreTrashItem(user, body.id);
      await writeAudit({ userId: user.id, ip, action: "TRASH_RESTORE", target: restored.path });
      return jsonOk(restored);
    }
    await purgeTrashItem(user, body.id);
    await writeAudit({ userId: user.id, ip, action: "TRASH_PURGE", target: body.id });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
