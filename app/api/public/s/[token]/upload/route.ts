import Busboy from "busboy";
import { Readable } from "node:stream";
import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/server/http";
import { uploadPublicShare } from "@/server/services/share-service";
import { assertSafeFileName } from "@/server/storage/path-resolver";

type Ctx = { params: Promise<{ token: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
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
    const nodeStream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
    const bb = Busboy({ headers, defCharset: "utf8", limits: { files: 1 } });
    const fields: Record<string, string> = {};
    const uploads: Promise<{ name: string; size: number }>[] = [];
    const waitForPassword = () =>
      new Promise<void>((resolve) => {
        if ("password" in fields) {
          resolve();
          return;
        }
        const started = Date.now();
        const timer = setInterval(() => {
          if ("password" in fields || Date.now() - started > 300) {
            clearInterval(timer);
            resolve();
          }
        }, 5);
      });
    const done = new Promise<void>((resolve, reject) => {
      bb.on("field", (name, value) => {
        fields[name] = value;
      });
      bb.on("file", (_name, file, info) => {
        const fileName = assertSafeFileName(info.filename || "upload.bin");
        uploads.push(
          waitForPassword().then(() =>
            uploadPublicShare(token, fields.password, fileName, file, fields.relative || "/"),
          ),
        );
      });
      bb.on("error", reject);
      bb.on("finish", () => resolve());
    });
    nodeStream.pipe(bb);
    await done;
    const [entry] = await Promise.all(uploads);
    if (!entry) throw new AppError("VALIDATION_ERROR", "Keine Datei.", 400);
    return jsonOk({ entry }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
