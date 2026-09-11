import { requirePermission } from "@/server/auth/require";
import { jsonError, jsonOk } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { getEnv } from "@/server/env";
import { hydrateStoragePaths } from "@/server/storage/config";
import { browseLinuxDirectories } from "@/server/storage/browse-linux";
import { extraVolumeBinds, EXTRA_VOLUMES_DIR, hydrateExtraVolumes } from "@/server/storage/extra-volumes";

export async function GET(request: Request) {
  try {
    await requirePermission("storage.global");
    const url = new URL(request.url);
    const dir = queryParam(url, "dir") || queryParam(url, "path", "/");
    const paths = await hydrateStoragePaths();
    const extras = await hydrateExtraVolumes();
    const shortcuts = [
      paths.storagePath,
      `${paths.storagePath.replace(/\/+$/, "")}/${EXTRA_VOLUMES_DIR}`,
      ...extras.map((vol) => vol.hostPath),
    ];
    const data = browseLinuxDirectories(
      dir || "/",
      shortcuts,
      paths.storagePath,
      extraVolumeBinds(paths.storagePath, extras),
      getEnv().hostStorage,
    );
    return jsonOk({
      ...data,
      storagePath: paths.storagePath,
      hostStorage: getEnv().hostStorage,
    });
  } catch (error) {
    return jsonError(error);
  }
}
