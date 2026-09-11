import { z } from "zod";
import { requirePermission } from "@/server/auth/require";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { deleteUser, getUserById, updateUser } from "@/server/services/user-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("users.view");
    const { id } = await ctx.params;
    return jsonOk({ user: await getUserById(id) });
  } catch (error) {
    return jsonError(error);
  }
}

const patchSchema = z.object({
  username: z.string().min(3).optional(),
  displayName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
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

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("users.update");
    const { id } = await ctx.params;
    const body = await readJson(request, patchSchema);
    const user = await updateUser(id, body, actor);
    await writeAudit({ userId: actor.id, ip: await clientIp(), action: "UPDATE_USER", target: user.username });
    return jsonOk({ user });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await assertSameOrigin();
    const actor = await requirePermission("users.delete");
    const { id } = await ctx.params;
    const existing = await getUserById(id);
    await deleteUser(id, actor.id);
    await writeAudit({ userId: actor.id, ip: await clientIp(), action: "DELETE_USER", target: existing.username });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
