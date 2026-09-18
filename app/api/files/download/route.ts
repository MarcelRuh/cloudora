import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { clientIp, jsonError } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { downloadTarget, zipDirectory, assertZipBudget } from "@/server/services/file-service";
import { mimeFromName } from "@/server/storage/mime";
import { fileStreamResponse, nodeStreamResponse, streamBodyHeaders } from "@/server/storage/http-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function GET(request: Request) {
  try {
    const user = await requireSession();
    const url = new URL(request.url);
    const virtualPath = queryParam(url, "path", "/");
    const { resolved, stat } = await downloadTarget(user, virtualPath);
    await writeAudit({ userId: user.id, ip: await clientIp(), action: "DOWNLOAD", target: resolved.virtualPath });

    if (stat.isDirectory()) {
      await assertZipBudget(resolved.absPath);
      const zipName = `${resolved.name || "folder"}.zip`;
      const archive = zipDirectory(resolved.absPath, resolved.name || "folder");
      return nodeStreamResponse(
        archive,
        streamBodyHeaders({
          mime: "application/zip",
          fileName: zipName,
          disposition: "attachment",
        }),
      );
    }

    return fileStreamResponse(
      request,
      resolved.absPath,
      stat,
      mimeFromName(resolved.name),
      "attachment",
      resolved.name,
    );
  } catch (error) {
    return jsonError(error);
  }
}
