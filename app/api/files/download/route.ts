import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { clientIp, jsonError } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { downloadTarget, openFileStream, zipDirectory } from "@/server/services/file-service";
import { contentDisposition, mimeFromName } from "@/server/storage/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireSession();
    const url = new URL(request.url);
    const virtualPath = queryParam(url, "path", "/");
    const { resolved, stat } = await downloadTarget(user, virtualPath);
    await writeAudit({ userId: user.id, ip: await clientIp(), action: "DOWNLOAD", target: resolved.virtualPath });

    if (stat.isDirectory()) {
      const zipName = `${resolved.name || "folder"}.zip`;
      const archive = zipDirectory(resolved.absPath, resolved.name || "folder");
      return new Response(archive as unknown as ReadableStream, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": contentDisposition(zipName, "attachment"),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const stream = openFileStream(resolved.absPath);
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": mimeFromName(resolved.name),
        "Content-Length": String(stat.size),
        "Content-Disposition": contentDisposition(resolved.name, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
