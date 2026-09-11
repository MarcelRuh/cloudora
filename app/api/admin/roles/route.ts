import { requirePermission } from "@/server/auth/require";
import { jsonError, jsonOk } from "@/server/http";
import { listRoles } from "@/server/services/user-service";
import { ALL_PERMISSIONS, PERMISSION_CATALOG, PERMISSION_GROUPS } from "@/lib/permissions";

export async function GET() {
  try {
    await requirePermission("roles.view");
    return jsonOk({
      roles: await listRoles(),
      catalog: PERMISSION_CATALOG,
      groups: PERMISSION_GROUPS,
      all: ALL_PERMISSIONS,
    });
  } catch (error) {
    return jsonError(error);
  }
}
