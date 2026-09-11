import { requirePermission } from "@/server/auth/require";
import { jsonError, jsonOk } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { getEnv } from "@/server/env";
import { hydrateStoragePaths } from "@/server/storage/config";
import { browseLinuxDirectories } from "@/server/storage/browse-linux";

export async function GET(request: Request) {
  try {
    await requirePermission("storage.global");
    const url = new URL(request.url);
    const dir = queryParam(url, "dir") || queryParam(url, "path", "/");
    const paths = await hydrateStoragePaths();
    const data = browseLinuxDirectories(dir || "/", [paths.storagePath], paths.storagePath);
    return jsonOk({
      ...data,
      storagePath: paths.storagePath,
      hostStorage: getEnv().hostStorage,
    });
  } catch (error) {
    return jsonError(error);
  }
}
