import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import {
  consumePublicShare,
  inspectPublicShare,
  listPublicShare,
  previewPublicShare,
} from "@/server/services/share-service";
import { contentDisposition } from "@/server/storage/mime";
import { fileStreamResponse } from "@/server/storage/http-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    return jsonOk(await inspectPublicShare(token));
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  password: z.string().optional(),
  op: z.enum(["download", "list", "preview"]).optional(),
  relative: z.string().optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const body = await readJson(request, schema).catch(() => ({ password: undefined, op: "download" as const, relative: "/" }));
    const op = body.op ?? "download";
    if (op === "list") {
      return jsonOk(await listPublicShare(token, body.password, body.relative));
    }
    if (op === "preview") {
      const result = await previewPublicShare(token, body.password, body.relative);
      return fileStreamResponse(request, result.absPath, result.stat, result.mime, "inline", result.name, {
        "Cache-Control": "no-store",
      });
    }
    const result = await consumePublicShare(token, body.password, body.relative);
    await writeAudit({ ip: await clientIp(), action: "SHARE_USED", target: result.name });
    const headers: Record<string, string> = {
      "Content-Type": result.mime,
      "Content-Disposition": contentDisposition(result.name, "attachment"),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (result.size != null) headers["Content-Length"] = String(result.size);
    return new Response(result.stream as unknown as ReadableStream, { headers });
  } catch (error) {
    return jsonError(error);
  }
}
