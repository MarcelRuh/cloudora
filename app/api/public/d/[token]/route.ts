import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { clientIp, clientUserAgent, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { inspectPublicDownload, consumePublicDownload } from "@/server/services/download-service";
import { contentDisposition } from "@/server/storage/mime";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    return jsonOk(await inspectPublicDownload(token));
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  password: z.string().optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const body = await readJson(request, schema).catch(() => ({ password: undefined }));
    const ip = await clientIp();
    const ua = await clientUserAgent();
    const result = await consumePublicDownload(token, body.password, ip, ua);
    await writeAudit({
      ip,
      userAgent: ua,
      action: "OTD_USED",
      target: result.name,
    });
    return new Response(result.stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": result.mime,
        "Content-Length": String(result.size),
        "Content-Disposition": contentDisposition(result.name, "attachment"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
