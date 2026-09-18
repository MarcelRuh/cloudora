import { requirePermission } from "@/server/auth/require";
import { jsonError, jsonOk } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { hydrateStoragePaths } from "@/server/storage/config";
import { inspectLinuxPath } from "@/server/storage/browse-linux";

export async function GET(request: Request) {
  try {
    await requirePermission("storage.global");
    const url = new URL(request.url);
    const dir = queryParam(url, "dir") || queryParam(url, "path", "");
    const paths = await hydrateStoragePaths();
    const data = inspectLinuxPath(dir, paths.storagePath);
    return jsonOk({
      ...data,
      storagePath: paths.storagePath,
    });
  } catch (error) {
    return jsonError(error);
  }
}
