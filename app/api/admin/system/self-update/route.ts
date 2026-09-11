import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/auth/require";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { userHasPermission } from "@/lib/permissions";
import { applySelfUpdate, getSelfUpdateStatus } from "@/server/services/self-update-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requirePermission("system.view");
    const status = await getSelfUpdateStatus();
    return jsonOk({ ...status, canApply: userHasPermission(user, "system.update") });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    await assertSameOrigin();
    const user = await requirePermission("system.update");
    const result = await applySelfUpdate();
    await writeAudit({
      userId: user.id,
      ip: await clientIp(),
      action: "SELF_UPDATE_STARTED",
      target: "cloudora",
      result: result.ok ? "SUCCESS" : "FAILURE",
      error: result.ok ? null : result.message,
    });
    return jsonOk(result, result.ok ? 200 : 400);
  } catch (error) {
    return jsonError(error);
  }
}
