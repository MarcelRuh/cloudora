import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { createUser, listUsers } from "@/server/services/user-service";

export async function GET() {
  try {
    await requirePermission("users.view");
    return jsonOk({ users: await listUsers() });
  } catch (error) {
    return jsonError(error);
  }
}

const createSchema = z.object({
  username: z.string().min(3),
  displayName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  roleSlug: z.enum(["administrator", "user"]).optional(),
  homePathEnabled: z.boolean().optional(),
  homePath: z.string().max(512).optional(),
  quotaBytes: z.number().int().nonnegative().nullable().optional(),
  canUpload: z.boolean().optional(),
  canDownload: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canShare: z.boolean().optional(),
  canOneTimeDownload: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("users.create");
    const body = await readJson(request, createSchema);
    const user = await createUser(body);
    await writeAudit({ userId: actor.id, ip: await clientIp(), action: "CREATE_USER", target: user.username });
    return jsonOk({ user }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
