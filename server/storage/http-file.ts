import fs from "node:fs";
import type { Stats } from "node:fs";
import { contentDisposition } from "@/server/storage/mime";

export function fileStreamResponse(
  request: Request,
  absPath: string,
  stat: Stats,
  mime: string,
  disposition: "inline" | "attachment",
  fileName: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const size = Number(stat.size);
  const rangeHeader = request.headers.get("range");
  const common = {
    "Accept-Ranges": "bytes",
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(fileName, disposition),
    "Cache-Control": extraHeaders["Cache-Control"] ?? "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  };

  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return new Response(fs.createReadStream(absPath) as unknown as ReadableStream, {
      headers: { ...common, "Content-Length": String(size) },
    });
  }

  const spec = rangeHeader.slice(6).split(",")[0]?.trim() ?? "";
  const [startRaw, endRaw] = spec.split("-");
  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  return new Response(fs.createReadStream(absPath, { start, end }) as unknown as ReadableStream, {
    status: 206,
    headers: {
      ...common,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
}
