import Busboy from "busboy";
import { Readable } from "node:stream";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { assertSameOrigin, clientIp, jsonError, jsonOk } from "@/server/http";
import { uploadFile } from "@/server/services/file-service";
import { assertSafeFileName } from "@/server/storage/path-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    const user = await requireSession();
    const ip = await clientIp();
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      throw new AppError("VALIDATION_ERROR", "Erwarte multipart/form-data.", 400);
    }

    const body = request.body;
    if (!body) throw new AppError("VALIDATION_ERROR", "Leerer Upload.", 400);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const url = new URL(request.url);
    const pathFromQuery = url.searchParams.get("path") || "/";

    const nodeStream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
    const bb = Busboy({ headers, defCharset: "utf8", limits: { files: 32 } });

    const fields: Record<string, string> = { path: pathFromQuery };
    const uploads: Promise<unknown>[] = [];

    const done = new Promise<void>((resolve, reject) => {
      bb.on("field", (name, value) => {
        fields[name] = value;
      });
      bb.on("file", (_name, file, info) => {
        const fileName = assertSafeFileName(info.filename || "upload.bin");
        const parent = fields.path || "/";
        const relativePath = fields.relativePath || "";
        uploads.push(
          uploadFile(user, parent, fileName, file, undefined, relativePath).then(async (entry) => {
            await writeAudit({ userId: user.id, ip, action: "UPLOAD", target: entry.path });
            return entry;
          }),
        );
      });
      bb.on("error", reject);
      bb.on("finish", () => resolve());
    });

    nodeStream.pipe(bb);
    await done;
    const entries = await Promise.all(uploads);
    return jsonOk({ entries });
  } catch (error) {
    return jsonError(error);
  }
}
