import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { userHasPermission } from "@/lib/permissions";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { createOneTimeDownload, listOneTimeDownloads } from "@/server/services/download-service";

export async function GET() {
  try {
    const user = await requireSession();
    const items = await listOneTimeDownloads(user, userHasPermission(user, "downloads.manage"));
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  path: z.string(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
  maxDownloads: z.number().int().min(1).max(100).optional(),
  password: z.string().min(1).optional(),
  description: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const body = await readJson(request, schema);
    const item = await createOneTimeDownload(user, body);
    await writeAudit({ userId: user.id, ip: await clientIp(), action: "OTD_CREATE", target: item.name });
    return jsonOk({ item }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
