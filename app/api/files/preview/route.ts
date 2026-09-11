import { AppError } from "@/lib/errors";
import { previewable, kindOf } from "@/lib/file-kinds";
import { requireSession } from "@/server/auth/session";
import { jsonError } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { downloadTarget, readEditableContent } from "@/server/services/file-service";
import { mimeFromName } from "@/server/storage/mime";
import { fileStreamResponse } from "@/server/storage/http-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireSession();
    const url = new URL(request.url);
    const virtualPath = queryParam(url, "path", "");
    const { resolved, stat } = await downloadTarget(user, virtualPath);
    if (stat.isDirectory()) throw new AppError("NOT_A_FILE", "Ordner haben keine Vorschau.", 400);
    const kind = kindOf(resolved.name, false);
    if (!previewable(kind)) {
      throw new AppError("NO_PREVIEW", "Für diesen Dateityp gibt es keine Vorschau.", 415);
    }
    if (kind === "text" || kind === "code") {
      const data = await readEditableContent(user, virtualPath);
      return Response.json({ kind, name: data.name, content: data.content });
    }
    const streamHeaders: Record<string, string> = {
      "Content-Security-Policy":
        kind === "video" || kind === "audio"
          ? "default-src 'none'; media-src 'self'"
          : "default-src 'none'; img-src 'self' data:; style-src 'none'; sandbox",
    };
    return fileStreamResponse(
      request,
      resolved.absPath,
      stat,
      mimeFromName(resolved.name),
      "inline",
      resolved.name,
      streamHeaders,
    );
  } catch (error) {
    return jsonError(error);
  }
}
