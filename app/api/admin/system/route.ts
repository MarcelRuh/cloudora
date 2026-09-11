import { requirePermission } from "@/server/auth/require";
import { jsonError, jsonOk } from "@/server/http";
import { latestGithubRelease, systemInfo } from "@/server/services/system-service";
import { APP_VERSION } from "@/lib/version";

export async function GET() {
  try {
    await requirePermission("system.view");
    const [info, release] = await Promise.all([systemInfo(), latestGithubRelease()]);
    return jsonOk({
      ...info,
      currentVersion: APP_VERSION,
      latestVersion: release.latest,
      updateAvailable: Boolean(release.latest && release.latest !== APP_VERSION),
      releaseUrl: release.htmlUrl,
    });
  } catch (error) {
    return jsonError(error);
  }
}
