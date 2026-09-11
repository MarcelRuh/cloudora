import { requireSession } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http";
import { startTrashPurgeJob } from "@/server/jobs/trash-purge";
import { dashboardStats } from "@/server/services/dashboard-service";

export async function GET() {
  try {
    const user = await requireSession();
    startTrashPurgeJob();
    const stats = await dashboardStats(user);
    return jsonOk(stats);
  } catch (error) {
    return jsonError(error);
  }
}
