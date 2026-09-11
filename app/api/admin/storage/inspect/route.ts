import { requirePermission } from "@/server/auth/require";
import { jsonError, jsonOk } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { getEnv } from "@/server/env";
import { hydrateStoragePaths } from "@/server/storage/config";
import { inspectLinuxPath } from "@/server/storage/browse-linux";
import { extraVolumeBinds, hydrateExtraVolumes } from "@/server/storage/extra-volumes";

export async function GET(request: Request) {
  try {
    await requirePermission("storage.global");
    const url = new URL(request.url);
    const dir = queryParam(url, "dir") || queryParam(url, "path", "");
    const [paths, extras] = await Promise.all([hydrateStoragePaths(), hydrateExtraVolumes()]);
    const data = inspectLinuxPath(dir, paths.storagePath, extraVolumeBinds(paths.storagePath, extras));
    return jsonOk({
      ...data,
      storagePath: paths.storagePath,
      hostStorage: getEnv().hostStorage,
    });
  } catch (error) {
    return jsonError(error);
  }
}
