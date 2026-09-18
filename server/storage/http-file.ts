import fs from "node:fs";
import type { Stats } from "node:fs";
import { Readable } from "node:stream";
import type { Readable as NodeReadable } from "node:stream";
import { contentDisposition } from "@/server/storage/mime";

export function isByteRangeResume(request: Request): boolean {
  const range = request.headers.get("range");
  if (!range?.startsWith("bytes=")) return false;
  const spec = range.slice(6).split(",")[0]?.trim() ?? "";
  const startRaw = spec.split("-")[0];
  if (!startRaw) return true;
  const start = Number(startRaw);
  return Number.isFinite(start) && start > 0;
}

export function nodeReadableToWeb(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as NodeReadable) as ReadableStream<Uint8Array>;
}

export function nodeStreamResponse(
  stream: NodeJS.ReadableStream,
  headers: HeadersInit,
  status = 200,
): Response {
  return new Response(nodeReadableToWeb(stream), { status, headers });
}

export function streamBodyHeaders(input: {
  mime: string;
  fileName: string;
  disposition: "inline" | "attachment";
  size?: number | null;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": input.mime,
    "Content-Disposition": contentDisposition(input.fileName, input.disposition),
    "Cache-Control": input.extra?.["Cache-Control"] ?? "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Encoding": "identity",
    "X-Accel-Buffering": "no",
    ...input.extra,
  };
  if (input.size != null && Number.isFinite(input.size) && input.size >= 0) {
    headers["Content-Length"] = String(input.size);
  }
  return headers;
}

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
    ...streamBodyHeaders({
      mime,
      fileName,
      disposition,
      extra: { "Cache-Control": extraHeaders["Cache-Control"] ?? "private, max-age=60", ...extraHeaders },
    }),
  };

  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return nodeStreamResponse(fs.createReadStream(absPath), { ...common, "Content-Length": String(size) });
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
  return nodeStreamResponse(
    fs.createReadStream(absPath, { start, end }),
    {
      ...common,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
    206,
  );
}
